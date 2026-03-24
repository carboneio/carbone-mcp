import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/utils/file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/file.js')>();
  return { ...actual, resolveFileInput: vi.fn() };
});

import { handleConvertDocument } from '../../../src/tools/convert.js';
import { resolveFileInput } from '../../../src/utils/file.js';
import type { CarboneClient } from '../../../src/carbone/client.js';
import { CarboneError } from '../../../src/carbone/errors.js';

const makeClient = (
  buffer = Buffer.from('pdf content'),
  filename = 'output.pdf'
) =>
  ({
    convertDocument: vi.fn().mockResolvedValue({ buffer, filename }),
  }) as unknown as CarboneClient;

describe('handleConvertDocument', () => {
  beforeEach(() => {
    vi.mocked(resolveFileInput).mockResolvedValue('resolved-base64==');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('resolves file input and passes template to client', async () => {
    const client = makeClient();
    await handleConvertDocument({ file: '/path/to/doc.docx', convertTo: 'pdf' }, client);

    expect(resolveFileInput).toHaveBeenCalledWith('/path/to/doc.docx');
    expect(vi.mocked(client.convertDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'resolved-base64==' }),
      undefined
    );
  });

  test('does not pass "file" field to client', async () => {
    const client = makeClient();
    await handleConvertDocument({ file: 'base64data', convertTo: 'pdf' }, client);

    const callArg = vi.mocked(client.convertDocument).mock.calls[0][0];
    expect(callArg).not.toHaveProperty('file');
  });

  test('returns EmbeddedResource for PDF output', async () => {
    const client = makeClient();
    const result = await handleConvertDocument({ file: 'data', convertTo: 'pdf' }, client);

    expect(result.content[0].type).toBe('resource');
  });

  test('returns TextContent for HTML output', async () => {
    const client = makeClient(Buffer.from('<h1>Hello</h1>'), 'output.html');
    const result = await handleConvertDocument({ file: 'data', convertTo: 'html' }, client);

    expect(result.content[0].type).toBe('text');
  });

  test('returns ImageContent for PNG output', async () => {
    const client = makeClient(Buffer.from('png bytes'), 'output.png');
    const result = await handleConvertDocument({ file: 'data', convertTo: 'png' }, client);

    expect(result.content[0].type).toBe('image');
  });

  test('passes converter to client', async () => {
    const client = makeClient();
    await handleConvertDocument({ file: 'data', convertTo: 'pdf', converter: 'C' }, client);

    expect(vi.mocked(client.convertDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ converter: 'C' }),
      undefined
    );
  });

  test('accepts advanced convertTo object', async () => {
    const client = makeClient();
    const convertTo = { formatName: 'pdf' as const, formatOptions: { EncryptFile: true } };
    await handleConvertDocument({ file: 'data', convertTo }, client);

    expect(vi.mocked(client.convertDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ convertTo }),
      undefined
    );
  });

  test('forwards options to client.convertDocument', async () => {
    const client = makeClient();
    await handleConvertDocument({ file: 'data', convertTo: 'pdf' }, client, { apiKey: 'custom-key' });

    expect(vi.mocked(client.convertDocument)).toHaveBeenCalledWith(
      expect.anything(),
      { apiKey: 'custom-key' }
    );
  });

  test('returns isError on client error', async () => {
    const client = {
      convertDocument: vi.fn().mockRejectedValue(new CarboneError('Conversion failed', 422)),
    } as unknown as CarboneClient;

    const result = await handleConvertDocument({ file: 'data', convertTo: 'pdf' }, client);

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
  });
});
