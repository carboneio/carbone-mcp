import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';
import { getMimeType, toToolContent, resolveFileInput, resolveJsonInput, writeOutputFile, isBlockedIp } from '../../../src/utils/file.js';

// Mock node:fs/promises at the top level so vi.mock hoisting works correctly
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
}));

// DNS is mocked so the SSRF guard never performs a real lookup in unit tests.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { readFile, stat, writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';

/** Default stat stub (small file) so size-limit checks pass unless a test overrides it. */
function stubStatSize(size: number) {
  vi.mocked(stat).mockResolvedValueOnce({ size } as unknown as Awaited<ReturnType<typeof stat>>);
}

/** Point the SSRF guard's DNS lookup at an address (defaults to a public one). */
function stubDns(address = '93.184.216.34') {
  vi.mocked(lookup).mockResolvedValue([{ address, family: 4 }] as never);
}

/** Local-path reads are fail-closed; stdio callers opt in. */
const LOCAL = { allowLocalPath: true } as const;

beforeEach(() => stubDns());

describe('getMimeType', () => {
  test('returns correct MIME type for common formats', () => {
    expect(getMimeType('pdf')).toBe('application/pdf');
    expect(getMimeType('docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(getMimeType('xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(getMimeType('pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
  });

  test('returns correct MIME type for image formats', () => {
    expect(getMimeType('png')).toBe('image/png');
    expect(getMimeType('jpg')).toBe('image/jpeg');
    expect(getMimeType('jpeg')).toBe('image/jpeg');
    expect(getMimeType('webp')).toBe('image/webp');
    expect(getMimeType('svg')).toBe('image/svg+xml');
  });

  test('returns correct MIME type for text formats', () => {
    expect(getMimeType('html')).toBe('text/html');
    expect(getMimeType('csv')).toBe('text/csv');
    expect(getMimeType('txt')).toBe('text/plain');
    expect(getMimeType('md')).toBe('text/markdown');
  });

  test('is case-insensitive', () => {
    expect(getMimeType('PDF')).toBe('application/pdf');
    expect(getMimeType('DOCX')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  });

  test('accepts object form with formatName', () => {
    expect(getMimeType({ formatName: 'pdf' })).toBe('application/pdf');
    expect(getMimeType({ formatName: 'png' })).toBe('image/png');
  });

  test('returns correct MIME type for idml, epub, and cdr', () => {
    expect(getMimeType('idml')).toBe('application/vnd.adobe.indesign-idml-package');
    expect(getMimeType('epub')).toBe('application/epub+zip');
    expect(getMimeType('cdr')).toBe('application/vnd.corel-draw');
  });

  test('returns octet-stream for unknown formats', () => {
    expect(getMimeType('unknown')).toBe('application/octet-stream');
  });
});

describe('toToolContent', () => {
  const buf = Buffer.from('hello world');

  test('returns TextContent for HTML', () => {
    const result = toToolContent(buf, 'file.html', 'html');
    expect(result.type).toBe('text');
    if (result.type === 'text') expect(result.text).toBe('hello world');
  });

  test('asAttachment=true forces an EmbeddedResource for a text format', () => {
    const result = toToolContent(buf, 'file.html', 'html', true);
    expect(result.type).toBe('resource');
    if (result.type === 'resource') {
      expect(result.resource.mimeType).toBe('text/html');
      expect(result.resource.blob).toBe(buf.toString('base64'));
      expect(result.resource.uri).toBe('file://file.html');
    }
  });

  test('asAttachment=true forces an EmbeddedResource for an image format', () => {
    expect(toToolContent(buf, 'file.png', 'png', true).type).toBe('resource');
  });

  test('returns TextContent for CSV', () => {
    const result = toToolContent(buf, 'file.csv', 'csv');
    expect(result.type).toBe('text');
  });

  test('returns TextContent for TXT', () => {
    const result = toToolContent(buf, 'file.txt', 'txt');
    expect(result.type).toBe('text');
  });

  test('returns TextContent for Markdown', () => {
    const result = toToolContent(buf, 'file.md', 'md');
    expect(result.type).toBe('text');
  });

  test('returns TextContent for XML', () => {
    const result = toToolContent(buf, 'file.xml', 'xml');
    expect(result.type).toBe('text');
  });

  test('returns ImageContent for PNG', () => {
    const result = toToolContent(buf, 'file.png', 'png');
    expect(result.type).toBe('image');
    if (result.type === 'image') {
      expect(result.mimeType).toBe('image/png');
      expect(result.data).toBe(buf.toString('base64'));
    }
  });

  test('returns ImageContent for JPG', () => {
    const result = toToolContent(buf, 'file.jpg', 'jpg');
    expect(result.type).toBe('image');
    if (result.type === 'image') expect(result.mimeType).toBe('image/jpeg');
  });

  test('returns EmbeddedResource for PDF', () => {
    const result = toToolContent(buf, 'file.pdf', 'pdf');
    expect(result.type).toBe('resource');
    if (result.type === 'resource') {
      expect(result.resource.mimeType).toBe('application/pdf');
      expect(result.resource.blob).toBe(buf.toString('base64'));
      expect(result.resource.uri).toBe('file://file.pdf');
    }
  });

  test('returns EmbeddedResource for DOCX', () => {
    const result = toToolContent(buf, 'file.docx', 'docx');
    expect(result.type).toBe('resource');
  });

  test('accepts object format with formatName', () => {
    const result = toToolContent(buf, 'file.pdf', { formatName: 'pdf' });
    expect(result.type).toBe('resource');
  });

  test('returns TextContent for XHTML', () => {
    const result = toToolContent(buf, 'file.xhtml', 'xhtml');
    expect(result.type).toBe('text');
  });

  test('returns TextContent for Markdown (markdown alias)', () => {
    const result = toToolContent(buf, 'file.md', 'markdown');
    expect(result.type).toBe('text');
  });

  test('returns ImageContent for WEBP', () => {
    const result = toToolContent(buf, 'file.webp', 'webp');
    expect(result.type).toBe('image');
    if (result.type === 'image') expect(result.mimeType).toBe('image/webp');
  });

  test('returns EmbeddedResource for SVG (not an Anthropic-permitted image type)', () => {
    const result = toToolContent(buf, 'file.svg', 'svg');
    expect(result.type).toBe('resource');
    if (result.type === 'resource') expect(result.resource.mimeType).toBe('image/svg+xml');
  });

  test('GIF is an inline image; TIFF and BMP fall back to a resource', () => {
    expect(toToolContent(buf, 'file.gif', 'gif').type).toBe('image');
    expect(toToolContent(buf, 'file.tiff', 'tiff').type).toBe('resource');
    expect(toToolContent(buf, 'file.bmp', 'bmp').type).toBe('resource');
  });

  test('returns EmbeddedResource for XLSX', () => {
    const result = toToolContent(buf, 'file.xlsx', 'xlsx');
    expect(result.type).toBe('resource');
    if (result.type === 'resource') {
      expect(result.resource.mimeType).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
    }
  });

  test('returns EmbeddedResource for PPTX', () => {
    const result = toToolContent(buf, 'file.pptx', 'pptx');
    expect(result.type).toBe('resource');
  });

  test('returns EmbeddedResource for ODT', () => {
    const result = toToolContent(buf, 'file.odt', 'odt');
    expect(result.type).toBe('resource');
  });

  test('returns EmbeddedResource for ZIP', () => {
    const result = toToolContent(buf, 'file.zip', 'zip');
    expect(result.type).toBe('resource');
    if (result.type === 'resource') {
      expect(result.resource.mimeType).toBe('application/zip');
    }
  });

  test('returns EmbeddedResource for unknown format', () => {
    const result = toToolContent(buf, 'file.bin', 'bin');
    expect(result.type).toBe('resource');
    if (result.type === 'resource') {
      expect(result.resource.mimeType).toBe('application/octet-stream');
    }
  });

  test('sets correct uri from filename', () => {
    const result = toToolContent(buf, 'invoice.pdf', 'pdf');
    if (result.type === 'resource') {
      expect(result.resource.uri).toBe('file://invoice.pdf');
    }
  });
});

describe('resolveFileInput', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns base64 string unchanged when no path or URL detected', async () => {
    const base64 = 'SGVsbG8gV29ybGQ=';
    const result = await resolveFileInput(base64);
    expect(result).toBe(base64);
  });

  test('downloads file from HTTPS URL', async () => {
    const fileContent = Buffer.from('file content');
    // Buffer.from() may share an underlying pool ArrayBuffer — slice to get
    // only the bytes belonging to this buffer before passing to the mock.
    const arrayBuffer = fileContent.buffer.slice(
      fileContent.byteOffset,
      fileContent.byteOffset + fileContent.byteLength
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => arrayBuffer,
    } as unknown as Response);

    const result = await resolveFileInput('https://example.com/file.docx');
    expect(result).toBe(fileContent.toString('base64'));
  });

  test('throws on failed URL download', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as unknown as Response);

    await expect(resolveFileInput('https://example.com/missing.pdf')).rejects.toThrow(
      'Failed to download file from URL'
    );
  });

  test('reads a local absolute path', async () => {
    const fileContent = Buffer.from('local file');
    stubStatSize(fileContent.length);
    vi.mocked(readFile).mockResolvedValueOnce(fileContent as unknown as string);

    const result = await resolveFileInput('/absolute/path/to/file.docx', LOCAL);
    expect(vi.mocked(readFile)).toHaveBeenCalledWith('/absolute/path/to/file.docx');
    expect(result).toBe(fileContent.toString('base64'));
  });

  test('reads a local relative path (./)', async () => {
    const fileContent = Buffer.from('relative file');
    stubStatSize(fileContent.length);
    vi.mocked(readFile).mockResolvedValueOnce(fileContent as unknown as string);

    const result = await resolveFileInput('./template.docx', LOCAL);
    expect(result).toBe(fileContent.toString('base64'));
  });

  test('expands ~ to home directory', async () => {
    const fileContent = Buffer.from('home file');
    stubStatSize(fileContent.length);
    vi.mocked(readFile).mockResolvedValueOnce(fileContent as unknown as string);
    const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '~';

    await resolveFileInput('~/Documents/template.docx', LOCAL);

    expect(vi.mocked(readFile)).toHaveBeenCalledWith(`${home}/Documents/template.docx`);
  });

  test('reads a Windows absolute path (C:\\)', async () => {
    const fileContent = Buffer.from('windows file');
    stubStatSize(fileContent.length);
    vi.mocked(readFile).mockResolvedValueOnce(fileContent as unknown as string);

    const result = await resolveFileInput('C:\\Users\\user\\template.docx', LOCAL);
    expect(vi.mocked(readFile)).toHaveBeenCalledWith('C:\\Users\\user\\template.docx');
    expect(result).toBe(fileContent.toString('base64'));
  });

  test('throws when local file is not found', async () => {
    // stat() is called before readFile, so the ENOENT surfaces from there.
    vi.mocked(stat).mockRejectedValueOnce(
      Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    );

    await expect(resolveFileInput('/nonexistent/file.docx', LOCAL)).rejects.toThrow('ENOENT');
  });

  // ── size limit + timeout ──────────────────────────────────────────────────

  test('rejects a local file larger than the limit (before reading it)', async () => {
    vi.mocked(readFile).mockClear();
    stubStatSize(999);
    await expect(resolveFileInput('/big/file.docx', { maxBytes: 10, allowLocalPath: true })).rejects.toThrow('exceeds the maximum');
    expect(vi.mocked(readFile)).not.toHaveBeenCalled();
  });

  test('rejects a URL download larger than the declared Content-Length', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '999' }),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);
    await expect(resolveFileInput('https://example.com/big.pdf', { maxBytes: 10 })).rejects.toThrow('exceeds the maximum');
  });

  test('rejects an oversized base64 string', async () => {
    await expect(resolveFileInput('A'.repeat(200), { maxBytes: 10 })).rejects.toThrow('exceeds the maximum');
  });

  test('over-limit message is cloud-aware (no env-var hint on cloud)', async () => {
    stubStatSize(999);
    await expect(
      resolveFileInput('/big/file.docx', { maxBytes: 10, isCloud: true, allowLocalPath: true })
    ).rejects.toThrow('Carbone Cloud limits');
  });

  test('wraps a URL download timeout in a clear error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' })
    );
    await expect(resolveFileInput('https://slow.example.com/file.pdf')).rejects.toThrow('Timed out');
  });

  test('passes an AbortSignal to the URL fetch', async () => {
    const fileContent = Buffer.from('x');
    const ab = fileContent.buffer.slice(fileContent.byteOffset, fileContent.byteOffset + fileContent.byteLength);
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => ab,
    } as unknown as Response);

    await resolveFileInput('https://example.com/file.pdf');

    expect(spy).toHaveBeenCalledWith(
      'https://example.com/file.pdf',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});

describe('security — SSRF and local-file guards', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('isBlockedIp', () => {
    test('blocks loopback, private, link-local/metadata, CGNAT and reserved ranges', () => {
      for (const ip of [
        '127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1',
        '169.254.169.254',            // AWS/GCP cloud metadata
        '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1', '240.0.0.1',
        '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1',
      ]) {
        expect(isBlockedIp(ip), `${ip} must be blocked`).toBe(true);
      }
    });

    test('allows ordinary public addresses', () => {
      for (const ip of ['93.184.216.34', '1.1.1.1', '8.8.8.8', '172.32.0.1', '2606:4700::1']) {
        expect(isBlockedIp(ip), `${ip} must be allowed`).toBe(false);
      }
    });

    test('rejects anything that is not a valid IP literal', () => {
      expect(isBlockedIp('not-an-ip')).toBe(true);
    });
  });

  test('refuses a URL whose host resolves to cloud metadata (SSRF)', async () => {
    stubDns('169.254.169.254');
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(resolveFileInput('http://metadata.evil.example/latest/meta-data/'))
      .rejects.toThrow(/private or internal address/);
    expect(spy, 'must not issue the request at all').not.toHaveBeenCalled();
  });

  test('refuses a literal private IP URL without any DNS lookup', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(resolveFileInput('http://127.0.0.1:8080/secret')).rejects.toThrow(/private or internal address/);
    expect(spy).not.toHaveBeenCalled();
  });

  test('re-validates redirects — a public host cannot bounce into internal space', async () => {
    vi.mocked(lookup)
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as never)  // first hop: public
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }] as never); // redirect target
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: 'http://metadata.evil.example/latest/meta-data/' }),
    } as unknown as Response);

    await expect(resolveFileInput('https://example.com/innocent.docx'))
      .rejects.toThrow(/private or internal address/);
  });

  test('CARBONE_ALLOW_PRIVATE_NETWORK opt-in permits an internal host', async () => {
    const body = Buffer.from('internal');
    const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => ab,
    } as unknown as Response);

    const result = await resolveFileInput('http://10.0.0.5/template.docx', { allowPrivateNetwork: true });
    expect(result).toBe(body.toString('base64'));
  });

  test('rejects a redirect into a non-http(s) scheme', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: 'file:///etc/passwd' }),
    } as unknown as Response);

    await expect(resolveFileInput('https://example.com/innocent.docx'))
      .rejects.toThrow(/Unsupported URL scheme/);
  });

  test('refuses to read a local path unless the caller opts in (HTTP mode)', async () => {
    vi.mocked(readFile).mockClear();
    for (const p of ['/proc/self/environ', './secret.txt', '~/.ssh/id_rsa', 'C:\\Windows\\win.ini']) {
      await expect(resolveFileInput(p), `${p} must be refused`).rejects.toThrow(/only supported in stdio/);
    }
    expect(vi.mocked(readFile), 'must never touch the filesystem').not.toHaveBeenCalled();
  });

  test('by-reference JSON params are guarded too (data via internal URL)', async () => {
    stubDns('169.254.169.254');
    await expect(resolveJsonInput('http://metadata.evil.example/creds', 'data'))
      .rejects.toThrow(/private or internal address/);
    await expect(resolveJsonInput('/etc/passwd', 'data')).rejects.toThrow(/only supported in stdio/);
  });
});

describe('resolveJsonInput', () => {
  afterEach(() => vi.restoreAllMocks());

  test('passes an inline object through unchanged', async () => {
    const obj = { customer: 'Acme', total: 1500 };
    expect(await resolveJsonInput(obj, 'data')).toBe(obj);
  });

  test('passes an inline array through unchanged (top-level array data)', async () => {
    const arr = [{ id: 1 }, { id: 2 }];
    expect(await resolveJsonInput(arr, 'data')).toBe(arr);
  });

  test('passes undefined through (optional params)', async () => {
    expect(await resolveJsonInput(undefined, 'complement')).toBeUndefined();
  });

  test('parses a raw inline JSON object string', async () => {
    expect(await resolveJsonInput('{"a":1}', 'data')).toEqual({ a: 1 });
  });

  test('parses a raw inline JSON array string', async () => {
    expect(await resolveJsonInput(' [1, 2, 3] ', 'data')).toEqual([1, 2, 3]);
  });

  test('decodes and parses a base64 JSON string', async () => {
    const b64 = Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64');
    expect(await resolveJsonInput(b64, 'data')).toEqual({ hello: 'world' });
  });

  test('reads and parses a local JSON file path', async () => {
    const json = Buffer.from(JSON.stringify([{ id: 1 }, { id: 2 }]));
    stubStatSize(json.length);
    vi.mocked(readFile).mockResolvedValueOnce(json as unknown as string);

    const result = await resolveJsonInput('/data/invoices.json', 'data', LOCAL);
    expect(vi.mocked(readFile)).toHaveBeenCalledWith('/data/invoices.json');
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test('downloads and parses a JSON URL', async () => {
    const json = Buffer.from(JSON.stringify({ from: 'url' }));
    const arrayBuffer = json.buffer.slice(json.byteOffset, json.byteOffset + json.byteLength);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => arrayBuffer,
    } as unknown as Response);

    expect(await resolveJsonInput('https://example.com/data.json', 'data')).toEqual({ from: 'url' });
  });

  test('throws a field-named error when the reference is not valid JSON', async () => {
    await expect(resolveJsonInput('not-valid-json-or-path', 'translations')).rejects.toThrow(
      'Invalid JSON for "translations"'
    );
  });
});

describe('writeOutputFile', () => {
  afterEach(() => vi.restoreAllMocks());

  test('writes the buffer to disk and returns the resolved path and size', async () => {
    vi.mocked(writeFile).mockResolvedValueOnce(undefined as never);
    const buffer = Buffer.from('hello');

    const result = await writeOutputFile('/tmp/out.pdf', buffer);

    expect(vi.mocked(writeFile)).toHaveBeenCalledWith('/tmp/out.pdf', buffer);
    expect(result).toEqual({ path: '/tmp/out.pdf', size: 5 });
  });

  test('expands ~ in the output path', async () => {
    vi.mocked(writeFile).mockResolvedValueOnce(undefined as never);
    const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '~';

    const result = await writeOutputFile('~/out.docx', Buffer.from('x'));

    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(`${home}/out.docx`, expect.anything());
    expect(result.path).toBe(`${home}/out.docx`);
  });
});
