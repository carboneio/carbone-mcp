import { readFile, stat, writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

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

/** Maximum redirect hops followed for a user-supplied URL — every hop is re-validated. */
const MAX_REDIRECTS = 5;

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
  /**
   * Whether a local filesystem path may be read. Fail-closed by default: only stdio (where the
   * server runs on the caller's own machine) enables it. In HTTP mode the path would resolve on
   * the *server's* disk, so a caller could read server files (e.g. /proc/self/environ).
   */
  allowLocalPath?: boolean;
  /**
   * Whether URLs resolving to private/loopback/link-local addresses may be fetched. Fail-closed by
   * default to prevent SSRF (cloud metadata at 169.254.169.254, localhost, RFC1918). Operators with
   * internal template hosts opt in via CARBONE_ALLOW_PRIVATE_NETWORK=true.
   */
  allowPrivateNetwork?: boolean;
}

/**
 * True when an IP literal belongs to a range that must never be reachable from a user-supplied URL:
 * loopback, private (RFC1918), link-local (incl. 169.254.169.254 cloud metadata), CGNAT, multicast,
 * and reserved space — for both IPv4 and IPv6. IPv6 is compared on its 16 bytes, so every notation of
 * the same address (hex, dotted, compressed) gets the same answer, and an IPv4 address embedded in an
 * IPv6 one (mapped, compatible, NAT64, 6to4) is checked against the IPv4 rules.
 */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ipv6Bytes(ip));
  return true; // not a valid IP literal — reject rather than guess
}

function isBlockedIpv4(ip: string): boolean {
  const o = ip.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = o as [number, number, number, number];
  if (a === 0) return true;                                  // 0.0.0.0/8 "this network"
  if (a === 10) return true;                                 // 10/8 private
  if (a === 127) return true;                                // 127/8 loopback
  if (a === 169 && b === 254) return true;                   // 169.254/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;          // 172.16/12 private
  if (a === 192 && b === 168) return true;                   // 192.168/16 private
  if (a === 192 && b === 0) return true;                      // 192.0.0/24 + 192.0.2/24 special-use
  if (a === 100 && b >= 64 && b <= 127) return true;         // 100.64/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true;      // 198.18/15 benchmarking
  if (a >= 224) return true;                                 // 224/4 multicast + 240/4 reserved
  return false;
}

/** Parse a valid IPv6 literal (as accepted by net.isIP) into its 16 bytes. A zone id ("%eth0") is ignored. */
function ipv6Bytes(ip: string): number[] {
  let text = ip.split('%')[0]!.toLowerCase();
  // A trailing dotted IPv4 part (::ffff:1.2.3.4) becomes the last two hex groups.
  const dotted = text.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(2).map(Number) as [number, number, number, number];
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  // Expand the single "::" (if any) to the missing zero groups.
  const [left, right] = text.split('::') as [string, string | undefined];
  const head = left ? left.split(':') : [];
  const tail = right ? right.split(':') : [];
  const groups = right === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
  return groups.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 0xff];
  });
}

/** True when bytes[from, to) are all zero. */
function zeros(bytes: number[], from: number, to: number): boolean {
  return bytes.slice(from, to).every((b) => b === 0);
}

/** Check the IPv4 address held in bytes[at, at+4) against the IPv4 rules. */
function embeddedIpv4Blocked(bytes: number[], at: number): boolean {
  return isBlockedIpv4(bytes.slice(at, at + 4).join('.'));
}

function isBlockedIpv6(b: number[]): boolean {
  // ::/96 IPv4-compatible (also covers :: unspecified and ::1 loopback, which embed 0.0.0.0 / 0.0.0.1).
  if (zeros(b, 0, 12)) return embeddedIpv4Blocked(b, 12);
  // ::ffff:0:0/96 IPv4-mapped (::ffff:7f00:1 is 127.0.0.1).
  if (zeros(b, 0, 10) && b[10] === 0xff && b[11] === 0xff) return embeddedIpv4Blocked(b, 12);
  // ::ffff:0:0:0/96 IPv4-translated (SIIT).
  if (zeros(b, 0, 8) && b[8] === 0xff && b[9] === 0xff && zeros(b, 10, 12)) return embeddedIpv4Blocked(b, 12);
  // 64:ff9b::/96 NAT64 well-known prefix — the gateway connects to the embedded IPv4 address.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(b, 4, 12)) {
    return embeddedIpv4Blocked(b, 12);
  }
  // 64:ff9b:1::/48 local-use NAT64 (RFC 8215) — operator-internal by definition.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b[4] === 0x00 && b[5] === 0x01) return true;
  // 2002::/16 6to4 — the IPv4 address follows the prefix.
  if (b[0] === 0x20 && b[1] === 0x02) return embeddedIpv4Blocked(b, 2);
  // 2001::/32 Teredo — tunnels to an (obfuscated) IPv4 endpoint; never a legitimate template host.
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true;
  if ((b[0]! & 0xfe) === 0xfc) return true;                   // fc00::/7 unique-local
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true;  // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0xc0) return true;  // fec0::/10 site-local (deprecated)
  if (b[0] === 0xff) return true;                             // ff00::/8 multicast
  return false;
}

function refusal(target: string, address: string): Error {
  return new Error(
    `Refusing to fetch ${target} — it resolves to a private or internal address (${address}). ` +
    'Set CARBONE_ALLOW_PRIVATE_NETWORK=true to allow internal hosts on a trusted deployment.'
  );
}

/** Resolves a hostname to every address it has (the system resolver by default; injectable for tests). */
export type HostResolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const systemResolver: HostResolver = (hostname) => lookup(hostname, { all: true });

/**
 * Build the `lookup` hook handed to http(s).request, so DNS is resolved exactly once per connection:
 * every returned address is validated, and only then are the addresses given to the socket. The
 * address connected to is therefore always an address that passed isBlockedIp — a DNS server that
 * answers differently on a second query (DNS rebinding) never gets that second query.
 *
 * `target` names the host in error messages; it must not be text taken from a remote response.
 */
export function guardedLookup(target: string, resolver: HostResolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    resolver(hostname)
      .then(
        (all) => {
          const family = options.family === 4 || options.family === 6 ? options.family : 0;
          const addresses = family ? all.filter((a) => a.family === family) : all;
          if (addresses.length === 0) throw new Error(`Could not resolve host ${target}.`);
          const blocked = all.find((a) => isBlockedIp(a.address));
          if (blocked) throw refusal(target, blocked.address);
          return addresses;
        },
        () => { throw new Error(`Could not resolve host ${target}.`); }
      )
      .then(
        (addresses) => options.all
          ? callback(null, addresses)
          : callback(null, addresses[0]!.address, addresses[0]!.family),
        (err: NodeJS.ErrnoException) => callback(err, '')
      );
  };
}

/**
 * Validate a URL before connecting: http(s) only, and — unless private networks are allowed — an
 * IP-literal host must not be internal. IP literals skip DNS (and therefore the lookup hook), so they
 * are checked here; hostnames are checked by guardedLookup at connect time. Returns the lookup hook
 * to use for the connection (none when private networks are allowed).
 */
function assertUrlAllowed(url: URL, target: string, allowPrivateNetwork: boolean): LookupFunction | undefined {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported URL scheme for ${target} — only http and https are allowed.`);
  }
  if (allowPrivateNetwork) return undefined;

  const host = url.hostname.replace(/^\[|\]$/g, ''); // strip brackets from IPv6 literals
  if (isIP(host)) {
    if (isBlockedIp(host)) throw refusal(target, host);
    return undefined;
  }
  return guardedLookup(target);
}

/** Issue one GET, without following redirects. Resolves once the response headers have arrived. */
function requestOnce(url: URL, signal: AbortSignal, lookupHook: LookupFunction | undefined): Promise<IncomingMessage> {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(url, {
      method: 'GET',
      // A fresh agent per request: no pooled socket from an earlier connection is ever reused.
      agent: false,
      signal,
      // identity: the byte count enforced below is the byte count of the file itself.
      headers: { 'User-Agent': 'carbone-mcp', Accept: '*/*', 'Accept-Encoding': 'identity' },
      ...(lookupHook ? { lookup: lookupHook } : {}),
    }, resolve);
    req.on('error', reject);
    req.end();
  });
}

/**
 * GET a user-supplied URL, following redirects manually so each hop is re-checked against
 * assertUrlAllowed (an allowed host must not be able to redirect into internal space).
 * Redirect targets come from the remote server, so error messages never quote them.
 */
async function fetchGuarded(rawUrl: string, allowPrivateNetwork: boolean, signal: AbortSignal): Promise<IncomingMessage> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  let target = `"${url.origin}"`;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await requestOnce(url, signal, assertUrlAllowed(url, target, allowPrivateNetwork));
    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    if (status < 300 || status > 399 || !location) return response;

    response.destroy(); // the redirect body is never needed
    try {
      url = new URL(location, url); // resolve relative redirects, then re-validate
    } catch {
      throw new Error('Invalid redirect location while downloading from URL.');
    }
    target = 'the redirect target';
  }
  throw new Error(`Too many redirects (>${MAX_REDIRECTS}) while downloading from URL.`);
}

/** Read a response body, aborting as soon as it grows past maxBytes (Content-Length is not trusted). */
async function readBodyWithinLimit(response: IncomingMessage, maxBytes: number, isCloud: boolean): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of response as AsyncIterable<Buffer>) {
    received += chunk.length;
    // Throwing out of the loop destroys the response, so the rest of the body is never read.
    assertWithinLimit(received, maxBytes, isCloud);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, received);
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
  json:     'application/json',
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
  // Fail closed: callers must explicitly opt in (stdio enables local paths; the operator enables
  // private-network URLs). A caller that forgets is denied rather than silently exposed.
  const allowLocalPath = options?.allowLocalPath ?? false;
  const allowPrivateNetwork = options?.allowPrivateNetwork ?? false;

  // Remote URL — SSRF-guarded (private/internal addresses blocked at connect time, every redirect hop
  // re-validated), size-capped while streaming, and hard-timed-out (one deadline for every hop and the
  // body) so a slow/unresponsive host can't stall the request.
  if (input.startsWith('http://') || input.startsWith('https://')) {
    const signal = AbortSignal.timeout(URL_FETCH_TIMEOUT_MS);
    try {
      const response = await fetchGuarded(input, allowPrivateNetwork, signal);
      const status = response.statusCode ?? 0;
      if (status < 200 || status > 299) {
        response.destroy();
        // Status code only: the reason phrase is chosen by the remote server and is not repeated.
        throw new Error(`Failed to download file from URL: HTTP ${status}.`);
      }
      // Reject early when the server declares an oversized body…
      const declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        response.destroy();
        assertWithinLimit(declared, maxBytes, isCloud);
      }
      // …and count the bytes actually received, in case Content-Length was missing or understated.
      const buffer = await readBodyWithinLimit(response, maxBytes, isCloud);
      return buffer.toString('base64');
    } catch (err) {
      if (signal.aborted) {
        throw new Error(
          `Timed out after ${URL_FETCH_TIMEOUT_MS / 1000}s downloading file from URL: ${input}`
        );
      }
      // Network, TLS and HTTP-parser errors can quote remote content (e.g. certificate names), so only
      // their fixed error code is reported. This module's own errors carry no code and pass through.
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (typeof code === 'string') throw new Error(`Could not download file from URL (${code}).`);
      throw err;
    }
  }

  // Local file path: absolute (/…), relative (./… or ../…), home (~), or Windows (C:\…)
  const isLocalPath =
    input.startsWith('/') ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    input.startsWith('~') ||
    /^[A-Za-z]:[/\\]/.test(input);

  if (isLocalPath) {
    // Only stdio (server runs on the caller's own machine) may read local paths. In HTTP mode this
    // would read the server's filesystem, so it is refused — see SECURITY notes in the changelog.
    if (!allowLocalPath) {
      throw new Error(
        'Reading local file paths is only supported in stdio (local) mode. ' +
        'Pass an HTTPS URL or a base64 string instead.'
      );
    }
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
  } catch {
    // Fixed text on purpose: JSON.parse errors quote the input, which may be a fetched URL body or a
    // local file — repeating it would hand that content back to the caller.
    throw new Error(
      `Invalid JSON for "${field}": the content is not valid JSON. ` +
      'Pass an inline JSON object/array, or a local path / HTTPS URL / base64 string pointing to a JSON file.'
    );
  }
}

/**
 * Write a document buffer to a NEW local file (expanding a leading ~), returning the resolved path and
 * size. The file is created exclusively ('wx'): an existing file — or a symlink, even a dangling one —
 * at that path is never overwritten or followed. It is readable by the current user only (0o600), since
 * generated documents often carry personal or business data.
 */
export async function writeOutputFile(
  outputPath: string,
  buffer: Buffer
): Promise<{ path: string; size: number }> {
  const resolvedPath = expandHome(outputPath);
  try {
    await writeFile(resolvedPath, buffer, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === 'EEXIST') {
      throw new Error(
        `Output file ${resolvedPath} already exists — refusing to overwrite it. Choose a new file name for outputPath.`
      );
    }
    throw err;
  }
  return { path: resolvedPath, size: buffer.length };
}

/** Output formats represented inline as plain text. */
export const TEXT_OUTPUT_FORMATS = new Set(['html', 'xhtml', 'txt', 'csv', 'md', 'markdown', 'xml', 'json']);

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
