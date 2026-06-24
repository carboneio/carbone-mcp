import { readFile, stat, writeFile } from 'node:fs/promises';

export type FormatArg = string | { formatName: string };

/** Expand a leading ~ to the user's home directory; other paths are returned unchanged. */
export function expandHome(p: string): string {
  return p.startsWith('~')
    ? p.replace('~', process.env['HOME'] ?? process.env['USERPROFILE'] ?? '~')
    : p;
}

/** Default local cap for a single resolved input file (100 MB). Overridable via CARBONE_MAX_FILE_BYTES. */
const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024;

/** Hard timeout for downloading a file from a user/AI-supplied URL, so a request never hangs. */
const URL_FETCH_TIMEOUT_MS = 60_000;

export interface ResolveFileOptions {
  /** Maximum allowed size in bytes. Defaults to 100 MB (the operator sets CARBONE_MAX_FILE_BYTES via config). */
  maxBytes?: number;
  /**
   * Whether the request targets the Carbone cloud API. On cloud the hard limits
   * (20 MB per template, 60 MB of JSON data) are enforced by Carbone itself, so the
   * over-limit error points there instead of suggesting CARBONE_MAX_FILE_BYTES —
   * which only takes effect on self-hosted instances.
   */
  isCloud?: boolean;
}

function assertWithinLimit(bytes: number, maxBytes: number, isCloud: boolean): void {
  if (bytes <= maxBytes) return;
  const mb = Math.round(maxBytes / 1024 / 1024);
  throw new Error(
    isCloud
      ? `File exceeds the maximum allowed size of ${mb} MB (${bytes} bytes). ` +
        'Carbone Cloud limits are 20 MB per template and 60 MB of JSON data.'
      : `File exceeds the maximum allowed size of ${mb} MB (${bytes} bytes). ` +
        'Increase CARBONE_MAX_FILE_BYTES to raise the limit.'
  );
}

const MIME_TYPES: Record<string, string> = {
  // Documents
  pdf:  'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc:  'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls:  'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt:  'application/vnd.ms-powerpoint',
  odt:  'application/vnd.oasis.opendocument.text',
  ods:  'application/vnd.oasis.opendocument.spreadsheet',
  odp:  'application/vnd.oasis.opendocument.presentation',
  odg:  'application/vnd.oasis.opendocument.graphics',
  // Web / text
  html:     'text/html',
  xhtml:    'application/xhtml+xml',
  txt:      'text/plain',
  csv:      'text/csv',
  md:       'text/markdown',
  markdown: 'text/markdown',
  xml:      'application/xml',
  rtf:      'application/rtf',
  // Images
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg:  'image/svg+xml',
  tiff: 'image/tiff',
  bmp:  'image/bmp',
  gif:  'image/gif',
  // Archives
  zip: 'application/zip',
  // Publishing / other
  epub: 'application/epub+zip',
  idml: 'application/vnd.adobe.indesign-idml-package',
  cdr:  'application/vnd.corel-draw',
};

/** Returns the MIME type for a given output format (string or object form). */
export function getMimeType(format: FormatArg): string {
  const name = typeof format === 'string' ? format : format.formatName;
  return MIME_TYPES[name.toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolve a file input to a base64 string. Accepts:
 *   - HTTP/HTTPS URL  → downloaded and base64-encoded
 *   - Local file path → read from disk and base64-encoded
 *   - Base64 string   → returned as-is
 *
 * This lets AI assistants pass a path or URL directly without
 * having to encode the file themselves.
 */
export async function resolveFileInput(input: string, options?: ResolveFileOptions): Promise<string> {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
  const isCloud = options?.isCloud ?? false;

  // Remote URL — downloaded with a hard timeout so a slow/unresponsive host can't stall the request.
  if (input.startsWith('http://') || input.startsWith('https://')) {
    let response: Response;
    try {
      response = await fetch(input, { signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS) });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new Error(
          `Timed out after ${URL_FETCH_TIMEOUT_MS / 1000}s downloading file from URL: ${input}`
        );
      }
      throw err;
    }
    if (!response.ok) {
      throw new Error(
        `Failed to download file from URL: ${response.status} ${response.statusText}`
      );
    }
    // Reject early when the server declares an oversized body…
    const declared = Number(response.headers?.get('content-length'));
    if (Number.isFinite(declared) && declared > 0) assertWithinLimit(declared, maxBytes, isCloud);
    const buffer = Buffer.from(await response.arrayBuffer());
    // …and again after download, in case Content-Length was missing or understated.
    assertWithinLimit(buffer.length, maxBytes, isCloud);
    return buffer.toString('base64');
  }

  // Local file path: absolute (/…), relative (./… or ../…), home (~), or Windows (C:\…)
  const isLocalPath =
    input.startsWith('/') ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    input.startsWith('~') ||
    /^[A-Za-z]:[/\\]/.test(input);

  if (isLocalPath) {
    const resolvedPath = expandHome(input);
    // Check the size before reading so a huge file can't blow up memory.
    const { size } = await stat(resolvedPath);
    assertWithinLimit(size, maxBytes, isCloud);
    const buffer = await readFile(resolvedPath);
    return buffer.toString('base64');
  }

  // Already base64 — approximate the decoded size (base64 encodes 3 bytes per 4 chars).
  assertWithinLimit(Math.floor((input.length * 3) / 4), maxBytes, isCloud);
  return input;
}

/**
 * Resolve a JSON-valued tool argument that may be given inline or by reference.
 *
 * - Non-string (object or array) → returned unchanged (inline JSON, the common case).
 * - String → a reference, resolved to JSON and parsed:
 *     - starts with `{` or `[` → treated as raw inline JSON text and parsed directly
 *     - otherwise → a local path / HTTPS URL / base64 (via resolveFileInput) whose bytes are parsed
 *
 * A string can never be ambiguous with inline data, because inline JSON is passed as an object/array,
 * never as a string. Lets large datasets (and translation maps, etc.) be passed by path/URL instead of
 * inlined into the tool call. Throws a clear, field-named error when the resolved content isn't valid JSON.
 */
export async function resolveJsonInput(
  value: unknown,
  field: string,
  options?: ResolveFileOptions
): Promise<unknown> {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  let text: string;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    text = trimmed;
  } else {
    const base64 = await resolveFileInput(value, options);
    text = Buffer.from(base64, 'base64').toString('utf8');
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Invalid JSON for "${field}": ${err instanceof Error ? err.message : String(err)}. ` +
      'Pass an inline JSON object/array, or a local path / HTTPS URL / base64 string pointing to a JSON file.'
    );
  }
}

/** Write a document buffer to a local path (expanding a leading ~), returning the resolved path and size. */
export async function writeOutputFile(
  outputPath: string,
  buffer: Buffer
): Promise<{ path: string; size: number }> {
  const resolvedPath = expandHome(outputPath);
  await writeFile(resolvedPath, buffer);
  return { path: resolvedPath, size: buffer.length };
}

/** Output formats represented inline as plain text. */
export const TEXT_OUTPUT_FORMATS = new Set(['html', 'xhtml', 'txt', 'csv', 'md', 'markdown', 'xml']);

/**
 * MIME types Anthropic's tool-result image block accepts (verified: JPEG, PNG, GIF, WebP).
 * Other "image/*" types (svg, tiff, bmp) MUST NOT use an image block — the API rejects the
 * media_type — so they are delivered as a resource/file instead.
 */
export const INLINE_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** True when the format is safe to return inline (readable text or an Anthropic-viewable image). */
export function isInlineFormat(format: FormatArg): boolean {
  const formatName = (typeof format === 'string' ? format : format.formatName).toLowerCase();
  return TEXT_OUTPUT_FORMATS.has(formatName) || INLINE_IMAGE_MIME.has(getMimeType(format));
}

/**
 * Build the MCP tool content entry for a generated/converted document.
 * - asAttachment = true                            → EmbeddedResource with blob (downloadable file), any format
 * - Plain-text formats (HTML, CSV, TXT, MD, XML)  → TextContent (read inline)
 * - png / jpeg / gif / webp                        → ImageContent (viewable)
 * - Everything else (PDF, DOCX, svg, tiff, bmp, …) → EmbeddedResource with blob
 */
export function toToolContent(
  buffer: Buffer,
  filename: string,
  format: FormatArg,
  asAttachment = false
): TextContent | ImageContent | EmbeddedResource {
  const formatName = (typeof format === 'string' ? format : format.formatName).toLowerCase();
  const mimeType = getMimeType(format);

  const asResource = (): EmbeddedResource => ({
    type: 'resource',
    resource: { uri: `file://${filename}`, mimeType, blob: buffer.toString('base64') },
  });

  // Explicit download request → always a file attachment, regardless of format.
  if (asAttachment) {
    return asResource();
  }

  if (TEXT_OUTPUT_FORMATS.has(formatName)) {
    return { type: 'text', text: buffer.toString('utf-8') };
  }

  // Only the four image types Anthropic permits in an image block; svg/tiff/bmp fall through.
  if (INLINE_IMAGE_MIME.has(mimeType)) {
    return { type: 'image', data: buffer.toString('base64'), mimeType };
  }

  return asResource();
}

// Minimal local types that mirror the MCP SDK content types
export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface EmbeddedResource {
  type: 'resource';
  resource: {
    uri: string;
    mimeType: string;
    blob: string;
  };
}
