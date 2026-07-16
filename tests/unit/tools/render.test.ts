import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/utils/file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/file.js')>();
  return { ...actual, resolveFileInput: vi.fn(), writeOutputFile: vi.fn() };
});

import { handleRenderDocument } from '../../../src/tools/render.js';
import { resolveFileInput, writeOutputFile } from '../../../src/utils/file.js';
import type { CarboneClient } from '../../../src/carbone/client.js';
import { CarboneError } from '../../../src/carbone/errors.js';

const makeClient = (
  buffer = Buffer.from('pdf content'),
  filename = 'output.pdf'
) =>
  ({
    renderDocument: vi.fn().mockResolvedValue({ buffer, filename }),
    renderUrl: (id: string) => `https://api.carbone.io/render/${id}`,
  }) as unknown as CarboneClient;

describe('handleRenderDocument', () => {
  beforeEach(() => {
    vi.mocked(resolveFileInput).mockResolvedValue('resolved-base64==');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('renders via templateId — resolveFileInput not called', async () => {
    const client = makeClient();
    await handleRenderDocument({ templateId: 'tpl123', data: { name: 'Acme' } }, client);

    expect(resolveFileInput).not.toHaveBeenCalled();
    expect(vi.mocked(client.renderDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: 'tpl123', data: { name: 'Acme' } }),
      undefined
    );
  });

  test('renders via inline template — resolveFileInput called with template value', async () => {
    const client = makeClient();
    await handleRenderDocument({ template: '/path/to/template.docx', data: {} }, client);

    expect(resolveFileInput).toHaveBeenCalledWith(
      '/path/to/template.docx',
      expect.objectContaining({ isCloud: undefined, allowLocalPath: false, allowPrivateNetwork: false })
    );
    expect(vi.mocked(client.renderDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'resolved-base64==' }),
      undefined
    );
  });

  test('saves to disk when outputPath is provided (stdio)', async () => {
    vi.mocked(writeOutputFile).mockResolvedValue({ path: '/out.pdf', size: 100 });
    const client = makeClient(Buffer.from('pdf content'), 'out.pdf');

    const result = await handleRenderDocument(
      { templateId: 'tpl1', data: {}, convertTo: 'pdf', outputPath: '/out.pdf' },
      client,
      undefined,
      { allowFileOutput: true, allowFileInput: true, allowPrivateNetwork: false, maxFileBytes: 100 }
    );

    expect(vi.mocked(writeOutputFile)).toHaveBeenCalledWith('/out.pdf', expect.anything());
    expect((result.content[0] as { text: string }).text).toContain('/out.pdf');
  });

  test('returnLink: returns a one-time download URL', async () => {
    const client = {
      renderDocument: vi.fn().mockResolvedValue({ renderId: 'RID9.pdf' }),
      renderUrl: (id: string) => `https://api.carbone.io/render/${id}`,
    } as unknown as CarboneClient;

    const result = await handleRenderDocument(
      { templateId: 'tpl1', data: {}, convertTo: 'pdf', returnLink: true },
      client
    );

    expect(vi.mocked(client.renderDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ returnLink: true }),
      undefined
    );
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('https://api.carbone.io/render/RID9.pdf');
    expect(text).toContain('ONCE');
  });

  test('infers format from result filename when convertTo is omitted', async () => {
    const client = makeClient(Buffer.from('pdf content'), 'output.pdf');
    const result = await handleRenderDocument({ templateId: 'tpl1', data: {} }, client);

    // 'pdf' → EmbeddedResource
    expect(result.content[0].type).toBe('resource');
  });

  test('uses convertTo for format when provided', async () => {
    const client = makeClient(Buffer.from('<h1>Hi</h1>'), 'output.html');
    const result = await handleRenderDocument(
      { templateId: 'tpl1', data: {}, convertTo: 'html' },
      client
    );

    // 'html' → TextContent
    expect(result.content[0].type).toBe('text');
  });

  test('returns ImageContent when output is an image format', async () => {
    const client = makeClient(Buffer.from('png bytes'), 'chart.png');
    const result = await handleRenderDocument(
      { templateId: 'tpl1', data: {}, convertTo: 'png' },
      client
    );

    expect(result.content[0].type).toBe('image');
  });

  test('passes all optional params through to client', async () => {
    const client = makeClient();
    await handleRenderDocument(
      {
        templateId: 'tpl1',
        data: { x: 1 },
        convertTo:      'pdf',
        converter:      'O',
        lang:           'fr-fr',
        timezone:       'Europe/Paris',
        complement:     { company: 'Acme' },
        reportName:     'report.pdf',
        hardRefresh:    true,
        batchSplitBy:   'd.items',
        batchOutput:    'zip',
        batchReportName:'item-{d.id}.pdf',
      },
      client
    );

    expect(vi.mocked(client.renderDocument)).toHaveBeenCalledWith(
      expect.objectContaining({
        converter:      'O',
        lang:           'fr-fr',
        timezone:       'Europe/Paris',
        complement:     { company: 'Acme' },
        reportName:     'report.pdf',
        hardRefresh:    true,
        batchSplitBy:   'd.items',
        batchOutput:    'zip',
        batchReportName:'item-{d.id}.pdf',
      }),
      undefined
    );
  });

  test('forwards options to client.renderDocument', async () => {
    const client = makeClient();
    await handleRenderDocument({ templateId: 'tpl1', data: {} }, client, { apiKey: 'custom-key' });

    expect(vi.mocked(client.renderDocument)).toHaveBeenCalledWith(
      expect.anything(),
      { apiKey: 'custom-key' }
    );
  });

  test('returns text content with Carbone message for async (webhook) render', async () => {
    const client = {
      renderDocument: vi.fn().mockResolvedValue({ async: true, message: 'A render ID will be sent to your callback URL' }),
    } as unknown as CarboneClient;

    const result = await handleRenderDocument(
      { templateId: 'tpl1', data: {}, webhookUrl: 'https://example.com/webhook' },
      client
    );

    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toBe('A render ID will be sent to your callback URL');
    }
    expect(result.isError).toBeUndefined();
  });

  test('passes webhookUrl and webhookHeaders through to client', async () => {
    const client = {
      renderDocument: vi.fn().mockResolvedValue({ async: true, message: 'Queued' }),
    } as unknown as CarboneClient;

    await handleRenderDocument(
      {
        templateId: 'tpl1',
        data: {},
        webhookUrl: 'https://example.com/webhook',
        webhookHeaders: { authorization: 'my-secret', 'custom-id': '12345' },
      },
      client
    );

    expect(vi.mocked(client.renderDocument)).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookUrl: 'https://example.com/webhook',
        webhookHeaders: { authorization: 'my-secret', 'custom-id': '12345' },
      }),
      undefined
    );
  });

  test('returns isError on client error', async () => {
    const client = {
      renderDocument: vi.fn().mockRejectedValue(new CarboneError('Render failed', 422)),
    } as unknown as CarboneClient;

    const result = await handleRenderDocument({ templateId: 'tpl1', data: {} }, client);

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain('Render');
    }
  });

  test('accepts data as an inline JSON string (parsed before sending to client)', async () => {
    const client = makeClient();
    await handleRenderDocument({ templateId: 'tpl1', data: '{"customer":"Acme","total":5}' }, client);

    expect(vi.mocked(client.renderDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ data: { customer: 'Acme', total: 5 } }),
      undefined
    );
  });

  test('accepts data as a top-level array', async () => {
    const client = makeClient();
    await handleRenderDocument({ templateId: 'tpl1', data: [{ id: 1 }, { id: 2 }] }, client);

    expect(vi.mocked(client.renderDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ id: 1 }, { id: 2 }] }),
      undefined
    );
  });

  test('resolves object params (translations) passed as a JSON string reference', async () => {
    const client = makeClient();
    await handleRenderDocument(
      { templateId: 'tpl1', data: {}, lang: 'fr-fr', translations: '{"fr-fr":{"hi":"Bonjour"}}' },
      client
    );

    expect(vi.mocked(client.renderDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ translations: { 'fr-fr': { hi: 'Bonjour' } } }),
      undefined
    );
  });
});
