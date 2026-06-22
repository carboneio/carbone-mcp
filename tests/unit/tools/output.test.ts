import { describe, test, expect, vi, afterEach } from 'vitest';

vi.mock('../../../src/utils/file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/file.js')>();
  return { ...actual, writeOutputFile: vi.fn() };
});

import { saveOrReject } from '../../../src/tools/output.js';
import { writeOutputFile } from '../../../src/utils/file.js';

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
