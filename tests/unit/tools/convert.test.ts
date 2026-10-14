import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/utils/file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/file.js')>();
  return { ...actual, resolveFileInput: vi.fn(), writeOutputFile: vi.fn() };
});

import { handleConvertDocument } from '../../../src/tools/convert.js';
import { resolveFileInput, writeOutputFile } from '../../../src/utils/file.js';
import { CarboneClient } from '../../../src/carbone/client.js';
import { CarboneAuthError, CarboneError } from '../../../src/carbone/errors.js';

const makeClient = (
  buffer = Buffer.from('pdf content'),
  filename = 'output.pdf'
) =>
  ({
    assertCanAuthenticate: vi.fn(),
    convertDocument: vi.fn().mockResolvedValue({ buffer, filename }),
    renderUrl: (id: string) => `https://api.carbone.io/render/${id}`,
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

    // Gates are fail-closed when no FileContext is supplied (i.e. never implicitly allow
    // local reads or private-network fetches).
    expect(resolveFileInput).toHaveBeenCalledWith(
      '/path/to/doc.docx',
      expect.objectContaining({ isCloud: undefined, allowLocalPath: false, allowPrivateNetwork: false })
    );
    expect(vi.mocked(client.convertDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'resolved-base64==' }),
      undefined
    );
  });

  test('saves to disk when outputPath is provided (stdio)', async () => {
    vi.mocked(writeOutputFile).mockResolvedValue({ path: '/out.pdf', size: 100 });
    const client = makeClient();

    const result = await handleConvertDocument(
      { file: '/in.docx', convertTo: 'pdf', outputPath: '/out.pdf' },
      client,
      undefined,
      { allowFileOutput: true, allowFileInput: true, allowPrivateNetwork: false, maxFileBytes: 100 }
    );

    expect(vi.mocked(writeOutputFile)).toHaveBeenCalledWith('/out.pdf', expect.anything());
    expect((result.content[0] as { text: string }).text).toContain('/out.pdf');
  });

  test('returnLink: returns a one-time download URL (renders with download=false)', async () => {
    const client = {
      assertCanAuthenticate: vi.fn(),
      convertDocument: vi.fn().mockResolvedValue({ renderId: 'RID123.pdf' }),
      renderUrl: (id: string) => `https://api.carbone.io/render/${id}`,
    } as unknown as CarboneClient;

    const result = await handleConvertDocument({ file: 'data', convertTo: 'pdf', returnLink: true }, client);

    expect(vi.mocked(client.convertDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ returnLink: true }),
      undefined
    );
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('https://api.carbone.io/render/RID123.pdf');
    expect(text).toContain('ONCE');
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

  test('passes converter "I" and hardRefresh to client', async () => {
    const client = makeClient();
    await handleConvertDocument({ file: 'data', convertTo: 'pdf', converter: 'I', hardRefresh: true }, client);

    expect(vi.mocked(client.convertDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ converter: 'I', hardRefresh: true }),
      undefined
    );
  });

  test('does not send reportName to Carbone (ignored without templating)', async () => {
    const client = makeClient();
    await handleConvertDocument({ file: 'data', convertTo: 'pdf', reportName: 'contract' }, client);

    expect(vi.mocked(client.convertDocument).mock.calls[0][0]).not.toHaveProperty('reportName');
  });

  test('applies reportName to the delivered filename (API cannot, templating is skipped)', async () => {
    const client = makeClient(Buffer.from('pdf bytes'), 'report.pdf');
    const result = await handleConvertDocument(
      { file: 'data', convertTo: 'pdf', reportName: 'contract', outputPath: undefined }, client, undefined,
      { allowFileOutput: false, allowFileInput: false, allowPrivateNetwork: false, maxFileBytes: 1e9 });

    // HTTP-mode delivery → EmbeddedResource whose uri carries the filename.
    expect((result.content[0] as { resource: { uri: string } }).resource.uri).toBe('file://contract.pdf');
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
      assertCanAuthenticate: vi.fn(),
      convertDocument: vi.fn().mockRejectedValue(new CarboneError('Conversion failed', 422)),
    } as unknown as CarboneClient;

    const result = await handleConvertDocument({ file: 'data', convertTo: 'pdf' }, client);

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
  });

  test('checks authentication BEFORE resolving the file (no URL is fetched without credentials)', async () => {
    vi.mocked(resolveFileInput).mockClear();
    const client = {
      assertCanAuthenticate: vi.fn(() => { throw new CarboneAuthError('No API key provided.'); }),
      convertDocument: vi.fn(),
    } as unknown as CarboneClient;

    const result = await handleConvertDocument({ file: 'https://example.com/doc.docx', convertTo: 'pdf' }, client);

    expect(result.isError).toBe(true);
    expect(result.content[0].type === 'text' && result.content[0].text).toContain('Authentication failed');
    expect(resolveFileInput).not.toHaveBeenCalled();
    expect(vi.mocked(client.convertDocument)).not.toHaveBeenCalled();
  });
});

describe('PDF → PDF: hardRefresh defaults to true when formatOptions must be applied', () => {
  // Carbone returns a PDF → PDF conversion unchanged unless hardRefresh is set, silently dropping the
  // formatOptions (measured live: EncryptFile without hardRefresh gives an unencrypted PDF).
  const PDF_B64 = Buffer.from('%PDF-1.7\n%fake\n').toString('base64');
  const DOCX_B64 = Buffer.from('PK\u0003\u0004word/document.xml').toString('base64');
  const encrypt = { formatName: 'pdf' as const, formatOptions: { EncryptFile: true, DocumentOpenPassword: 's3cret' } };

  /** The exact JSON body sent to POST /render/template. */
  async function bodyFor(input: string, args: Omit<Parameters<typeof handleConvertDocument>[0], 'file'>) {
    vi.mocked(resolveFileInput).mockResolvedValue(input);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(Buffer.from('%PDF-1.7'), { status: 200, headers: { 'content-disposition': 'filename="report.pdf"' } })
    );
    const client = new CarboneClient({ apiKey: 'test-key' });
    const result = await handleConvertDocument({ file: 'in', ...args }, client);
    expect(result.isError).toBeUndefined();
    return JSON.parse((fetchSpy.mock.calls.at(-1)![1] as RequestInit).body as string);
  }

  afterEach(() => vi.restoreAllMocks());

  test('PDF input + pdf with formatOptions → hardRefresh: true', async () => {
    expect(await bodyFor(PDF_B64, { convertTo: encrypt })).toEqual({ template: PDF_B64, convertTo: encrypt, hardRefresh: true });
  });

  test('PDF input + plain "pdf" (no formatOptions) → no hardRefresh: the file passes through untouched', async () => {
    expect(await bodyFor(PDF_B64, { convertTo: 'pdf' })).toEqual({ template: PDF_B64, convertTo: 'pdf' });
    const empty = { formatName: 'pdf' as const, formatOptions: {} };
    expect(await bodyFor(PDF_B64, { convertTo: empty })).toEqual({ template: PDF_B64, convertTo: empty });
  });

  test('an explicit hardRefresh: false is respected', async () => {
    expect(await bodyFor(PDF_B64, { convertTo: encrypt, hardRefresh: false }))
      .toEqual({ template: PDF_B64, convertTo: encrypt, hardRefresh: false });
  });

  test('a non-PDF input is left alone (the format changes, so the converter runs anyway)', async () => {
    expect(await bodyFor(DOCX_B64, { convertTo: encrypt })).toEqual({ template: DOCX_B64, convertTo: encrypt });
  });

  test('PDF input to another format is left alone', async () => {
    const png = { formatName: 'png' as const, formatOptions: { PixelWidth: 800 } };
    expect(await bodyFor(PDF_B64, { convertTo: png })).toEqual({ template: PDF_B64, convertTo: png });
  });
});
