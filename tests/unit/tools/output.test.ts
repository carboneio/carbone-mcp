import { describe, test, expect, vi, afterEach } from 'vitest';
import { join } from 'node:path';

vi.mock('../../../src/utils/file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/file.js')>();
  return { ...actual, writeOutputFile: vi.fn() };
});

vi.mock('node:fs/promises', () => ({ mkdtemp: vi.fn(async (prefix: string) => `${prefix}AbC123`) }));

import { saveOrReject, deliverDocument, deliver, oneTimeLinkResult, withReportName } from '../../../src/tools/output.js';
import { writeOutputFile } from '../../../src/utils/file.js';
import { mkdtemp } from 'node:fs/promises';

describe('saveOrReject', () => {
  afterEach(() => vi.restoreAllMocks());

  test('writes the file and returns a summary when file output is allowed', async () => {
    vi.mocked(writeOutputFile).mockResolvedValueOnce({ path: '/tmp/out.pdf', size: 5 });

    const result = await saveOrReject({
      buffer: Buffer.from('hello'), format: 'pdf', outputPath: '/tmp/out.pdf', allowFileOutput: true,
    });

    expect(writeOutputFile).toHaveBeenCalledWith('/tmp/out.pdf', expect.anything());
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('/tmp/out.pdf');
    expect(result.content[0].text).toContain('5 bytes');
    expect(result.content[0].text).toContain('pdf');
  });

  test('rejects without writing when file output is not allowed (HTTP mode)', async () => {
    vi.mocked(writeOutputFile).mockClear();
    const result = await saveOrReject({
      buffer: Buffer.from('x'), format: 'pdf', outputPath: '/tmp/out.pdf', allowFileOutput: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('only supported in stdio');
    expect(writeOutputFile).not.toHaveBeenCalled();
  });

  test('uses formatName for the object form of format', async () => {
    vi.mocked(writeOutputFile).mockResolvedValueOnce({ path: '/tmp/out.docx', size: 1 });

    const result = await saveOrReject({
      buffer: Buffer.from('x'), format: { formatName: 'docx' }, outputPath: '/tmp/out.docx', allowFileOutput: true,
    });

    expect(result.content[0].text).toContain('docx');
  });
});

describe('deliverDocument', () => {
  afterEach(() => vi.restoreAllMocks());

  test('text formats → inline text', async () => {
    const r = await deliverDocument({ buffer: Buffer.from('<h1>hi</h1>'), filename: 'f.html', format: 'html', allowFileOutput: false });
    expect(r.content[0].type).toBe('text');
  });

  test('png → inline image', async () => {
    const r = await deliverDocument({ buffer: Buffer.from('png'), filename: 'f.png', format: 'png', allowFileOutput: false });
    expect(r.content[0].type).toBe('image');
  });

  test('binary in stdio → saves to a fresh private temp dir (exclusive create), returns the path', async () => {
    vi.mocked(writeOutputFile).mockImplementationOnce(async (path, buffer) => ({ path, size: buffer.length }));
    const r = await deliverDocument({ buffer: Buffer.from('%PDF'), filename: 'invoice.pdf', format: 'pdf', allowFileOutput: true });
    const [prefix] = vi.mocked(mkdtemp).mock.calls.at(-1)!;
    expect(String(prefix)).toMatch(/carbone-mcp-$/);
    // Written through writeOutputFile ('wx', 0o600) inside the new directory, never into tmpdir() itself.
    expect(writeOutputFile).toHaveBeenLastCalledWith(join(`${prefix}AbC123`, 'invoice.pdf'), expect.anything());
    expect(r.content[0].type).toBe('text');
    expect((r.content[0] as { text: string }).text).toContain(join(`${prefix}AbC123`, 'invoice.pdf'));
  });

  test('binary in stdio → the hint names returnLink only for a tool that has it (not download_template)', async () => {
    vi.mocked(writeOutputFile)
      .mockImplementationOnce(async (path, buffer) => ({ path, size: buffer.length }))
      .mockImplementationOnce(async (path, buffer) => ({ path, size: buffer.length }));
    const base = { buffer: Buffer.from('%PDF'), filename: 'f.pdf', format: 'pdf', allowFileOutput: true };
    const textOf = (r: Awaited<ReturnType<typeof deliverDocument>>) => (r.content[0] as { text: string }).text;
    expect(textOf(await deliverDocument(base))).not.toMatch(/returnLink/);
    expect(textOf(await deliverDocument({ ...base, offerReturnLink: true }))).toMatch(/returnLink for a download URL/);
  });

  test('binary in stdio → a filename that is not a plain name falls back to a default', async () => {
    for (const filename of ['', '..', '.']) {
      vi.mocked(writeOutputFile).mockImplementationOnce(async (path, buffer) => ({ path, size: buffer.length }));
      await deliverDocument({ buffer: Buffer.from('%PDF'), filename, format: 'pdf', allowFileOutput: true });
      expect(String(vi.mocked(writeOutputFile).mock.calls.at(-1)![0])).toMatch(/carbone-mcp-AbC123[\\/]carbone-output\.pdf$/);
    }
  });

  test('binary in HTTP → attachment (EmbeddedResource), no disk write', async () => {
    vi.mocked(mkdtemp).mockClear();
    vi.mocked(writeOutputFile).mockClear();
    const r = await deliverDocument({ buffer: Buffer.from('%PDF'), filename: 'invoice.pdf', format: 'pdf', allowFileOutput: false });
    expect(r.content[0].type).toBe('resource');
    expect(mkdtemp).not.toHaveBeenCalled();
    expect(writeOutputFile).not.toHaveBeenCalled();
  });

  test('asAttachment forces an EmbeddedResource even for text', async () => {
    const r = await deliverDocument({ buffer: Buffer.from('<h1>hi</h1>'), filename: 'f.html', format: 'html', asAttachment: true, allowFileOutput: false });
    expect(r.content[0].type).toBe('resource');
  });

  test('outputPath → saved via writeOutputFile', async () => {
    vi.mocked(writeOutputFile).mockResolvedValueOnce({ path: '/out.pdf', size: 4 });
    const r = await deliverDocument({ buffer: Buffer.from('%PDF'), filename: 'f.pdf', format: 'pdf', outputPath: '/out.pdf', allowFileOutput: true });
    expect(writeOutputFile).toHaveBeenCalledWith('/out.pdf', expect.anything());
    expect((r.content[0] as { text: string }).text).toContain('/out.pdf');
  });
});

describe('deliver (dispatch)', () => {
  const opts = { allowFileOutput: false, renderUrl: (id: string) => `https://api.carbone.io/render/${id}` };

  test('async result → queued message', async () => {
    const r = await deliver({ async: true, message: 'queued' }, 'pdf', opts);
    expect((r.content[0] as { text: string }).text).toBe('queued');
  });

  test('renderId result → one-time download URL', async () => {
    const r = await deliver({ renderId: 'RID.pdf' }, 'pdf', opts);
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain('https://api.carbone.io/render/RID.pdf');
    expect(text).toContain('ONCE');
  });

  test('bytes result → delegates to deliverDocument', async () => {
    const r = await deliver({ buffer: Buffer.from('%PDF'), filename: 'f.pdf' }, 'pdf', opts);
    expect(r.content[0].type).toBe('resource');
  });

  test('bytes in stdio → the temp-file hint names returnLink (render_document and convert_document have it)', async () => {
    vi.mocked(writeOutputFile).mockImplementationOnce(async (path, buffer) => ({ path, size: buffer.length }));
    const r = await deliver({ buffer: Buffer.from('%PDF'), filename: 'f.pdf' }, 'pdf', { ...opts, allowFileOutput: true });
    expect((r.content[0] as { text: string }).text).toMatch(/returnLink for a download URL/);
  });
});

describe('oneTimeLinkResult', () => {
  test('includes the URL and a one-time warning', () => {
    const r = oneTimeLinkResult('https://api.carbone.io/render/X.pdf', 'pdf');
    const text = (r.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('https://api.carbone.io/render/X.pdf');
    expect(text).toContain('ONCE');
    expect(text).toContain('do NOT fetch');
  });
});

describe('withReportName (reportName applied by the MCP when Carbone skips templating)', () => {
  const bytes = { buffer: Buffer.from('x'), filename: 'report.pdf' };

  test('names the file <reportName>.<ext>, keeping Carbone\'s extension', () => {
    expect(withReportName(bytes, 'contract', 'pdf').filename).toBe('contract.pdf');
    expect(withReportName({ ...bytes, filename: 'report.txt' }, 'notes', { formatName: 'txt' }).filename).toBe('notes.txt');
  });

  test('falls back to the target format when the returned filename has no extension', () => {
    expect(withReportName({ ...bytes, filename: 'document' }, 'contract', 'docx').filename).toBe('contract.docx');
  });

  test('does not double a matching extension, and neutralises path separators and control characters', () => {
    expect(withReportName(bytes, 'contract.PDF', 'pdf').filename).toBe('contract.PDF');
    expect(withReportName(bytes, '../etc/x\\y\n', 'pdf').filename).toBe('.._etc_x_y_.pdf');
  });

  test('leaves results without bytes, and an unset reportName, unchanged', () => {
    const link = { renderId: 'r1' };
    expect(withReportName(link, 'contract', 'pdf')).toBe(link);
    expect(withReportName(bytes, undefined, 'pdf')).toBe(bytes);
  });
});
