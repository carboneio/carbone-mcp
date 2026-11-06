import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

vi.mock('../../../src/utils/file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/file.js')>();
  return { ...actual, resolveFileInput: vi.fn() };
});

import {
  OPENAI_FILE_PARAMS, chatFileMeta, chatFileSchema, pickFile,
} from '../../../src/tools/attachments.js';
import { convertDocumentSchemaFor, handleConvertDocument } from '../../../src/tools/convert.js';
import { handleRenderDocument, renderDocumentSchemaFor, TEMPLATE_XOR_MESSAGE } from '../../../src/tools/render.js';
import { handleInspectTemplate, inspectTemplateSchemaFor } from '../../../src/tools/inspect.js';
import { handleUploadTemplate, uploadTemplateSchemaFor } from '../../../src/tools/templates.js';
import { transportToolsFor } from '../../../src/tools/index.js';
import { resolveFileInput } from '../../../src/utils/file.js';
import type { CarboneClient } from '../../../src/carbone/client.js';

const STDIO = { allowLocalPath: true, allowFileOutput: true };
const HTTP = { allowLocalPath: false, allowFileOutput: false };

// The runtime shape ChatGPT sends (https://developers.openai.com/apps-sdk/reference).
const ATTACHED = {
  download_url: 'https://files.example.test/file_abc?sig=1',
  file_id: 'file_abc',
  mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  file_name: 'invoice.docx',
};

const textOf = (r: { content: Array<{ type: string; text?: string }> }) => r.content[0]!.text ?? '';

describe('chat attachment schema (OpenAI Scan Tools rules)', () => {
  const json = z.toJSONSchema(chatFileSchema('template')) as {
    properties: Record<string, unknown>; required: string[]; description: string;
  };

  test('declares all four file properties and requires exactly download_url and file_id', () => {
    expect(Object.keys(json.properties).sort()).toEqual(['download_url', 'file_id', 'file_name', 'mime_type']);
    expect(json.required).toEqual(['download_url', 'file_id']);
  });

  test('tells other clients to leave it empty and names what it excludes', () => {
    expect(json.description).toMatch(/filled in by ChatGPT/);
    expect(json.description).toMatch(/Mutually exclusive with template\./);
    const render = z.toJSONSchema(chatFileSchema('template', 'template and templateId')) as { description: string };
    expect(render.description).toMatch(/Mutually exclusive with template and templateId\./);
  });

  test('accepts the shape ChatGPT sends, with or without the optional fields', () => {
    const schema = chatFileSchema('file');
    expect(schema.parse(ATTACHED)).toEqual(ATTACHED);
    expect(schema.parse({ download_url: ATTACHED.download_url, file_id: 'f' })).toEqual({ download_url: ATTACHED.download_url, file_id: 'f' });
  });

  test('refuses a download_url that is not HTTPS (it would otherwise be read as base64)', () => {
    const schema = chatFileSchema('file');
    expect(schema.safeParse({ ...ATTACHED, download_url: 'http://files.example.test/x' }).success).toBe(false);
    expect(schema.safeParse({ ...ATTACHED, download_url: 'UEsDBBQ=' }).success).toBe(false);
  });
});

describe('chat attachments are offered over HTTP only', () => {
  test('HTTP: the file inputs gain an attachment field and the tools declare it in _meta', () => {
    expect(convertDocumentSchemaFor(HTTP)).toHaveProperty('attachedFile');
    expect(renderDocumentSchemaFor(HTTP)).toHaveProperty('attachedTemplate');
    expect(inspectTemplateSchemaFor(HTTP)).toHaveProperty('attachedTemplate');
    expect(uploadTemplateSchemaFor(HTTP)).toHaveProperty('attachedTemplate');
    expect(transportToolsFor(HTTP).attachedTemplateMeta).toEqual({ _meta: { [OPENAI_FILE_PARAMS]: ['attachedTemplate'] } });
  });

  test('HTTP: file and template become optional (one of them or the attachment is checked at runtime)', () => {
    expect(z.object(convertDocumentSchemaFor(HTTP)).safeParse({ convertTo: 'pdf', attachedFile: ATTACHED }).success).toBe(true);
    expect(z.object(uploadTemplateSchemaFor(HTTP)).safeParse({ attachedTemplate: ATTACHED }).success).toBe(true);
  });

  test('stdio: no attachment field, no _meta, and file/template stay required', () => {
    expect(convertDocumentSchemaFor(STDIO)).not.toHaveProperty('attachedFile');
    expect(renderDocumentSchemaFor(STDIO)).not.toHaveProperty('attachedTemplate');
    expect(inspectTemplateSchemaFor(STDIO)).not.toHaveProperty('attachedTemplate');
    expect(uploadTemplateSchemaFor(STDIO)).not.toHaveProperty('attachedTemplate');
    expect(chatFileMeta(STDIO, 'attachedFile')).toEqual({});
    expect(z.object(convertDocumentSchemaFor(STDIO)).safeParse({ convertTo: 'pdf' }).success).toBe(false);
    expect(z.object(uploadTemplateSchemaFor(STDIO)).safeParse({}).success).toBe(false);
  });
});

describe('pickFile', () => {
  test('the string input, else the attachment URL, else nothing; both is an error', () => {
    expect(pickFile('https://example.test/a.docx', undefined, ['file', 'attachedFile'])).toEqual({ source: 'https://example.test/a.docx' });
    expect(pickFile(undefined, ATTACHED, ['file', 'attachedFile'])).toEqual({ source: ATTACHED.download_url });
    expect(pickFile(undefined, undefined, ['file', 'attachedFile'])).toEqual({ source: undefined });
    expect(pickFile('x', ATTACHED, ['file', 'attachedFile'])).toEqual({ error: 'Provide either file or attachedFile, not both.' });
  });
});

describe('handlers fetch the attachment like a URL input', () => {
  beforeEach(() => {
    vi.mocked(resolveFileInput).mockReset();
    vi.mocked(resolveFileInput).mockResolvedValue('resolved-base64==');
  });
  afterEach(() => vi.restoreAllMocks());

  const client = () => ({
    isCloud: true,
    assertCanAuthenticate: vi.fn(),
    convertDocument: vi.fn().mockResolvedValue({ buffer: Buffer.from('a,b'), filename: 'out.csv' }),
    renderDocument: vi.fn().mockResolvedValue({ buffer: Buffer.from('a,b'), filename: 'out.csv' }),
    inspectTemplate: vi.fn().mockResolvedValue({ markers: [], sample: {} }),
    uploadTemplate: vi.fn().mockResolvedValue({ id: 'tpl1', versionId: 'v1' }),
    renderUrl: (id: string) => `https://api.example.test/render/${id}`,
  }) as unknown as CarboneClient;

  test('convert_document', async () => {
    const c = client();
    const result = await handleConvertDocument({ attachedFile: ATTACHED, convertTo: 'csv' }, c);
    expect(result.isError).toBeUndefined();
    expect(resolveFileInput).toHaveBeenCalledWith(ATTACHED.download_url, expect.objectContaining({ allowPrivateNetwork: false }));
    // The attachment is never forwarded to the API as a field of its own.
    expect(vi.mocked(c.convertDocument).mock.calls[0]![0]).not.toHaveProperty('attachedFile');
  });

  test('convert_document: both file and attachedFile, or neither, is refused before any fetch', async () => {
    const both = await handleConvertDocument({ file: 'https://example.test/a.docx', attachedFile: ATTACHED, convertTo: 'pdf' }, client());
    expect(both.isError).toBe(true);
    expect(textOf(both)).toBe('Provide either file or attachedFile, not both.');
    const neither = await handleConvertDocument({ convertTo: 'pdf' }, client());
    expect(textOf(neither)).toBe('Provide the document to convert in file.');
    expect(resolveFileInput).not.toHaveBeenCalled();
  });

  test('render_document', async () => {
    const c = client();
    await handleRenderDocument({ attachedTemplate: ATTACHED, data: {}, convertTo: 'csv' }, c);
    expect(resolveFileInput).toHaveBeenCalledWith(ATTACHED.download_url, expect.anything());
    expect(vi.mocked(c.renderDocument)).toHaveBeenCalledWith(expect.objectContaining({ template: 'resolved-base64==' }), undefined);
  });

  test('inspect_template', async () => {
    const c = client();
    const result = await handleInspectTemplate({ attachedTemplate: ATTACHED }, c);
    expect(result.isError).toBeUndefined();
    expect(vi.mocked(c.inspectTemplate)).toHaveBeenCalledWith({ template: 'resolved-base64==' }, undefined);
  });

  test.each([
    ['render_document', handleRenderDocument],
    ['inspect_template', handleInspectTemplate],
  ] as const)('%s: attachedTemplate is exclusive with template and with templateId', async (_name, handle) => {
    expect(textOf(await handle({ template: 'x', attachedTemplate: ATTACHED }, client())))
      .toBe('Provide either template or attachedTemplate, not both.');
    expect(textOf(await handle({ templateId: 'tpl1', attachedTemplate: ATTACHED }, client()))).toBe(TEMPLATE_XOR_MESSAGE);
    expect(resolveFileInput).not.toHaveBeenCalled();
  });

  test('upload_template names the template after the attached file unless a name is given', async () => {
    const c = client();
    const result = await handleUploadTemplate({ attachedTemplate: ATTACHED }, c);
    expect(vi.mocked(c.uploadTemplate)).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'resolved-base64==', name: 'invoice.docx' }), undefined
    );
    expect(result.structuredContent).toMatchObject({ name: 'invoice.docx' });
    expect(textOf(result)).toMatch(/Name {8}: invoice\.docx/);

    const named = client();
    await handleUploadTemplate({ attachedTemplate: ATTACHED, name: 'Invoice' }, named);
    expect(vi.mocked(named.uploadTemplate)).toHaveBeenCalledWith(expect.objectContaining({ name: 'Invoice' }), undefined);

    // The name field is capped at 200 characters; an attachment without file_name stays unnamed.
    const long = client();
    await handleUploadTemplate({ attachedTemplate: { ...ATTACHED, file_name: 'a'.repeat(250) } }, long);
    expect(vi.mocked(long.uploadTemplate).mock.calls[0]![0].name).toHaveLength(200);
    const unnamed = client();
    await handleUploadTemplate({ attachedTemplate: { download_url: ATTACHED.download_url, file_id: 'f' } }, unnamed);
    expect(vi.mocked(unnamed.uploadTemplate).mock.calls[0]![0].name).toBeUndefined();
  });

  test('upload_template: both template and attachedTemplate, or neither, is refused', async () => {
    expect(textOf(await handleUploadTemplate({ template: 'x', attachedTemplate: ATTACHED }, client())))
      .toBe('Provide either template or attachedTemplate, not both.');
    expect(textOf(await handleUploadTemplate({}, client()))).toBe('Provide the template file in template.');
    expect(resolveFileInput).not.toHaveBeenCalled();
  });
});
