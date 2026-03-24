import { readFile } from 'node:fs/promises';

export type FormatArg = string | { formatName: string };

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
export async function resolveFileInput(input: string): Promise<string> {
  // Remote URL
  if (input.startsWith('http://') || input.startsWith('https://')) {
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(
        `Failed to download file from URL: ${response.status} ${response.statusText}`
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
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
    const resolvedPath = input.startsWith('~')
      ? input.replace('~', process.env['HOME'] ?? process.env['USERPROFILE'] ?? '~')
      : input;
    const buffer = await readFile(resolvedPath);
    return buffer.toString('base64');
  }

  // Already base64
  return input;
}

/**
 * Build the MCP tool content entry for a generated/converted document.
 * - Plain-text formats (HTML, CSV, TXT, MD, XML) → TextContent
 * - Image formats                                 → ImageContent
 * - All other binary formats (PDF, DOCX, …)       → EmbeddedResource with blob
 */
export function toToolContent(
  buffer: Buffer,
  filename: string,
  format: FormatArg
): TextContent | ImageContent | EmbeddedResource {
  const formatName = (typeof format === 'string' ? format : format.formatName).toLowerCase();
  const mimeType = getMimeType(format);

  const textFormats = new Set(['html', 'xhtml', 'txt', 'csv', 'md', 'markdown', 'xml']);
  if (textFormats.has(formatName)) {
    return { type: 'text', text: buffer.toString('utf-8') };
  }

  if (mimeType.startsWith('image/')) {
    return { type: 'image', data: buffer.toString('base64'), mimeType };
  }

  return {
    type: 'resource',
    resource: {
      uri: `file://${filename}`,
      mimeType,
      blob: buffer.toString('base64'),
    },
  };
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
