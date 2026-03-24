import { describe, test, expect, vi, afterEach } from 'vitest';
import { getMimeType, toToolContent, resolveFileInput } from '../../../src/utils/file.js';

// Mock node:fs/promises at the top level so vi.mock hoisting works correctly
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';

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

  test('returns ImageContent for SVG', () => {
    const result = toToolContent(buf, 'file.svg', 'svg');
    expect(result.type).toBe('image');
    if (result.type === 'image') expect(result.mimeType).toBe('image/svg+xml');
  });

  test('returns ImageContent for remaining image formats (tiff, bmp, gif)', () => {
    for (const fmt of ['tiff', 'bmp', 'gif'] as const) {
      expect(toToolContent(buf, `file.${fmt}`, fmt).type).toBe('image');
    }
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
    vi.mocked(readFile).mockResolvedValueOnce(fileContent as unknown as string);

    const result = await resolveFileInput('/absolute/path/to/file.docx');
    expect(vi.mocked(readFile)).toHaveBeenCalledWith('/absolute/path/to/file.docx');
    expect(result).toBe(fileContent.toString('base64'));
  });

  test('reads a local relative path (./)', async () => {
    const fileContent = Buffer.from('relative file');
    vi.mocked(readFile).mockResolvedValueOnce(fileContent as unknown as string);

    const result = await resolveFileInput('./template.docx');
    expect(result).toBe(fileContent.toString('base64'));
  });

  test('expands ~ to home directory', async () => {
    const fileContent = Buffer.from('home file');
    vi.mocked(readFile).mockResolvedValueOnce(fileContent as unknown as string);
    const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '~';

    await resolveFileInput('~/Documents/template.docx');

    expect(vi.mocked(readFile)).toHaveBeenCalledWith(`${home}/Documents/template.docx`);
  });

  test('reads a Windows absolute path (C:\\)', async () => {
    const fileContent = Buffer.from('windows file');
    vi.mocked(readFile).mockResolvedValueOnce(fileContent as unknown as string);

    const result = await resolveFileInput('C:\\Users\\user\\template.docx');
    expect(vi.mocked(readFile)).toHaveBeenCalledWith('C:\\Users\\user\\template.docx');
    expect(result).toBe(fileContent.toString('base64'));
  });

  test('throws when local file is not found', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(
      Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    );

    await expect(resolveFileInput('/nonexistent/file.docx')).rejects.toThrow('ENOENT');
  });
});
