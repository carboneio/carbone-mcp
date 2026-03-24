import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/utils/file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/file.js')>();
  return { ...actual, resolveFileInput: vi.fn() };
});

import { handleRenderDocument } from '../../../src/tools/render.js';
import { resolveFileInput } from '../../../src/utils/file.js';
import type { CarboneClient } from '../../../src/carbone/client.js';
import { CarboneError } from '../../../src/carbone/errors.js';

const makeClient = (
  buffer = Buffer.from('pdf content'),
  filename = 'output.pdf'
) =>
  ({
    renderDocument: vi.fn().mockResolvedValue({ buffer, filename }),
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

    expect(resolveFileInput).toHaveBeenCalledWith('/path/to/template.docx');
    expect(vi.mocked(client.renderDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'resolved-base64==' }),
      undefined
    );
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
});
