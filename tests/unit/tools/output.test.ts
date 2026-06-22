import { describe, test, expect, vi, afterEach } from 'vitest';

vi.mock('../../../src/utils/file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/file.js')>();
  return { ...actual, writeOutputFile: vi.fn() };
});

vi.mock('node:fs/promises', () => ({ writeFile: vi.fn() }));

import { saveOrReject, deliverDocument, deliver, oneTimeLinkResult } from '../../../src/tools/output.js';
import { writeOutputFile } from '../../../src/utils/file.js';
import { writeFile } from 'node:fs/promises';

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

  test('binary in stdio → saves to a temp file, returns the path', async () => {
    vi.mocked(writeFile).mockResolvedValueOnce(undefined as never);
    const r = await deliverDocument({ buffer: Buffer.from('%PDF'), filename: 'invoice.pdf', format: 'pdf', allowFileOutput: true });
    expect(writeFile).toHaveBeenCalled();
    expect(r.content[0].type).toBe('text');
    expect((r.content[0] as { text: string }).text).toContain('invoice.pdf');
  });

  test('binary in HTTP → attachment (EmbeddedResource), no disk write', async () => {
    vi.mocked(writeFile).mockClear();
    const r = await deliverDocument({ buffer: Buffer.from('%PDF'), filename: 'invoice.pdf', format: 'pdf', allowFileOutput: false });
    expect(r.content[0].type).toBe('resource');
    expect(writeFile).not.toHaveBeenCalled();
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
