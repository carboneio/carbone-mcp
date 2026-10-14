import { describe, test, expect } from 'vitest';
import {
  ConvertDocumentSchema,
  RenderDocumentSchema,
  UploadTemplateSchema,
  UpdateTemplateSchema,
  DeleteTemplateSchema,
  DownloadTemplateSchema,
  OutputFormatSchema,
} from '../../../src/validation/schemas.js';

describe('OutputFormatSchema', () => {
  test('accepts a simple format string', () => {
    expect(() => OutputFormatSchema.parse('pdf')).not.toThrow();
    expect(() => OutputFormatSchema.parse('docx')).not.toThrow();
    expect(() => OutputFormatSchema.parse('png')).not.toThrow();
  });

  test('accepts an object with formatName', () => {
    const result = OutputFormatSchema.parse({ formatName: 'pdf' });
    expect(result).toMatchObject({ formatName: 'pdf' });
  });

  test('accepts an object with formatName and formatOptions', () => {
    const result = OutputFormatSchema.parse({
      formatName: 'pdf',
      formatOptions: { EncryptFile: true, DocumentOpenPassword: 'secret' },
    });
    expect(result).toMatchObject({ formatName: 'pdf' });
  });

  test('rejects an unknown format string', () => {
    expect(() => OutputFormatSchema.parse('unknown_format')).toThrow();
  });

  test('rejects an object without formatName', () => {
    expect(() => OutputFormatSchema.parse({ formatOptions: {} })).toThrow();
  });

  test('accepts formats synced from the OpenAPI spec (doc) and the jpeg alias, in both forms', () => {
    for (const format of ['doc', 'jpeg']) {
      expect(OutputFormatSchema.parse(format)).toBe(format);
      expect(OutputFormatSchema.parse({ formatName: format })).toEqual({ formatName: format });
    }
  });

  test('rejects zip (batch container), cdr, and the spec content types Carbone Cloud cannot produce, in both forms', () => {
    for (const format of ['zip', 'cdr', 'xlsb', 'pps', 'pbm', 'pgm', 'ppm']) {
      expect(OutputFormatSchema.safeParse(format).success).toBe(false);
      expect(OutputFormatSchema.safeParse({ formatName: format }).success).toBe(false);
    }
  });
});

describe('ConvertDocumentSchema', () => {
  test('accepts required fields only', () => {
    const result = ConvertDocumentSchema.parse({
      file: 'base64data',
      convertTo: 'pdf',
    });
    expect(result.file).toBe('base64data');
    expect(result.convertTo).toBe('pdf');
    expect(result.converter).toBeUndefined();
  });

  test('accepts all fields', () => {
    const result = ConvertDocumentSchema.parse({
      file: 'base64data',
      convertTo: 'pdf',
      converter: 'L',
    });
    expect(result.converter).toBe('L');
  });

  test('accepts all converter values, including I (Carbone ICE)', () => {
    for (const converter of ['L', 'O', 'C', 'I'] as const) {
      const result = ConvertDocumentSchema.parse({
        file: 'base64data',
        convertTo: 'pdf',
        converter,
      });
      expect(result.converter).toBe(converter);
    }
  });

  test('accepts hardRefresh', () => {
    const result = ConvertDocumentSchema.parse({ file: 'data', convertTo: 'pdf', hardRefresh: true });
    expect(result.hardRefresh).toBe(true);
  });

  test('rejects convertTo zip and cdr', () => {
    for (const convertTo of ['zip', 'cdr']) {
      expect(ConvertDocumentSchema.safeParse({ file: 'data', convertTo }).success).toBe(false);
    }
  });

  test('egressAuthorization: 511 characters accepted, 512 rejected', () => {
    expect(ConvertDocumentSchema.safeParse({ file: 'data', convertTo: 'pdf', egressAuthorization: 'x'.repeat(511) }).success).toBe(true);
    expect(ConvertDocumentSchema.safeParse({ file: 'data', convertTo: 'pdf', egressAuthorization: 'x'.repeat(512) }).success).toBe(false);
  });

  test('accepts advanced format options', () => {
    const result = ConvertDocumentSchema.parse({
      file: 'base64data',
      convertTo: { formatName: 'pdf', formatOptions: { EncryptFile: true } },
    });
    expect(result.convertTo).toMatchObject({ formatName: 'pdf' });
  });

  test('rejects empty file', () => {
    expect(() =>
      ConvertDocumentSchema.parse({ file: '', convertTo: 'pdf' })
    ).toThrow();
  });

  test('rejects invalid converter', () => {
    expect(() =>
      ConvertDocumentSchema.parse({ file: 'data', convertTo: 'pdf', converter: 'X' })
    ).toThrow();
  });
});

describe('RenderDocumentSchema', () => {
  test('keepTags is accepted alone and rejected together with data', () => {
    expect(RenderDocumentSchema.safeParse({ templateId: 'tpl1', keepTags: true }).success).toBe(true);
    expect(RenderDocumentSchema.safeParse({ templateId: 'tpl1', keepTags: true, data: {} }).success).toBe(false);
  });

  test('accepts required fields', () => {
    const result = RenderDocumentSchema.parse({
      templateId: 'tpl123',
      data: { name: 'Acme' },
    });
    expect(result.templateId).toBe('tpl123');
    expect(result.data).toEqual({ name: 'Acme' });
    expect(result.convertTo).toBeUndefined();
  });

  test('accepts optional convertTo', () => {
    const result = RenderDocumentSchema.parse({
      templateId: 'tpl123',
      data: {},
      convertTo: 'pdf',
    });
    expect(result.convertTo).toBe('pdf');
  });

  test('accepts inline template instead of templateId', () => {
    const result = RenderDocumentSchema.parse({
      template: 'base64abc==',
      data: { name: 'Acme' },
    });
    expect(result.template).toBe('base64abc==');
    expect(result.templateId).toBeUndefined();
  });

  test('rejects when neither templateId nor template is provided', () => {
    expect(() =>
      RenderDocumentSchema.parse({ data: {} })
    ).toThrow();
  });

  test('rejects empty templateId', () => {
    expect(() =>
      RenderDocumentSchema.parse({ templateId: '', data: {} })
    ).toThrow();
  });

  test('accepts empty data object', () => {
    expect(() =>
      RenderDocumentSchema.parse({ templateId: 'tpl1', data: {} })
    ).not.toThrow();
  });

  test('rejects when both templateId and template are provided', () => {
    expect(() =>
      RenderDocumentSchema.parse({ templateId: 'tpl1', template: 'base64==', data: {} })
    ).toThrow();
  });

  test('accepts a valid webhookUrl', () => {
    const result = RenderDocumentSchema.parse({
      templateId: 'tpl1',
      data: {},
      webhookUrl: 'https://example.com/webhook',
    });
    expect(result.webhookUrl).toBe('https://example.com/webhook');
  });

  test('rejects an invalid webhookUrl', () => {
    expect(() =>
      RenderDocumentSchema.parse({ templateId: 'tpl1', data: {}, webhookUrl: 'not-a-url' })
    ).toThrow();
  });

  test('webhookUrl is optional', () => {
    const result = RenderDocumentSchema.parse({ templateId: 'tpl1', data: {} });
    expect(result.webhookUrl).toBeUndefined();
  });

  test('accepts webhookHeaders as a string record', () => {
    const result = RenderDocumentSchema.parse({
      templateId: 'tpl1',
      data: {},
      webhookUrl: 'https://example.com/webhook',
      webhookHeaders: { authorization: 'my-secret', 'custom-id': '12345' },
    });
    expect(result.webhookHeaders).toEqual({ authorization: 'my-secret', 'custom-id': '12345' });
  });

  test('rejects webhookHeaders with non-string values', () => {
    expect(() =>
      RenderDocumentSchema.parse({
        templateId: 'tpl1',
        data: {},
        webhookHeaders: { authorization: 123 },
      })
    ).toThrow();
  });

  test('accepts converter I and convertTo doc / jpeg; rejects convertTo zip / cdr', () => {
    expect(RenderDocumentSchema.parse({ templateId: 'tpl1', converter: 'I' }).converter).toBe('I');
    for (const convertTo of ['doc', 'jpeg']) {
      expect(RenderDocumentSchema.safeParse({ templateId: 'tpl1', convertTo }).success).toBe(true);
    }
    for (const convertTo of ['zip', 'cdr']) {
      expect(RenderDocumentSchema.safeParse({ templateId: 'tpl1', convertTo }).success).toBe(false);
    }
  });

  test('batchOutput: zip and pdf accepted, anything else rejected', () => {
    for (const batchOutput of ['zip', 'pdf']) {
      expect(RenderDocumentSchema.parse({ templateId: 'tpl1', batchOutput }).batchOutput).toBe(batchOutput);
    }
    expect(RenderDocumentSchema.safeParse({ templateId: 'tpl1', batchOutput: 'tar' }).success).toBe(false);
  });

  test('failOn: accepts ["IMAGE_URL_ERROR"], rejects unknown values and a bare string', () => {
    expect(RenderDocumentSchema.parse({ templateId: 'tpl1', failOn: ['IMAGE_URL_ERROR'] }).failOn).toEqual(['IMAGE_URL_ERROR']);
    expect(RenderDocumentSchema.safeParse({ templateId: 'tpl1', failOn: ['UNKNOWN_ERROR'] }).success).toBe(false);
    expect(RenderDocumentSchema.safeParse({ templateId: 'tpl1', failOn: 'IMAGE_URL_ERROR' }).success).toBe(false);
  });

  test('preReleaseFeatureIn: integer accepted, non-integer rejected', () => {
    expect(RenderDocumentSchema.parse({ templateId: 'tpl1', preReleaseFeatureIn: 5000000 }).preReleaseFeatureIn).toBe(5000000);
    expect(RenderDocumentSchema.safeParse({ templateId: 'tpl1', preReleaseFeatureIn: 1.5 }).success).toBe(false);
  });

  test('egressAuthorization: 511 characters accepted, 512 rejected', () => {
    expect(RenderDocumentSchema.safeParse({ templateId: 'tpl1', egressAuthorization: 'x'.repeat(511) }).success).toBe(true);
    expect(RenderDocumentSchema.safeParse({ templateId: 'tpl1', egressAuthorization: 'x'.repeat(512) }).success).toBe(false);
  });
});

describe('UploadTemplateSchema', () => {
  test('accepts required fields', () => {
    const result = UploadTemplateSchema.parse({
      template: 'base64data',
      name: 'Invoice Template',
    });
    expect(result.name).toBe('Invoice Template');
    expect(result.versioning).toBe(true); // default
  });

  test('accepts all optional fields', () => {
    const result = UploadTemplateSchema.parse({
      template: 'base64data',
      name: 'Invoice',
      category: 'invoices',
      tags: ['sales', 'billing'],
      versioning: false,
    });
    expect(result.category).toBe('invoices');
    expect(result.tags).toEqual(['sales', 'billing']);
    expect(result.versioning).toBe(false);
  });

  test('defaults versioning to true', () => {
    const result = UploadTemplateSchema.parse({ template: 'data', name: 'T' });
    expect(result.versioning).toBe(true);
  });

  test('rejects empty template', () => {
    expect(() =>
      UploadTemplateSchema.parse({ template: '', name: 'T' })
    ).toThrow();
  });

  test('rejects empty name', () => {
    expect(() =>
      UploadTemplateSchema.parse({ template: 'data', name: '' })
    ).toThrow();
  });

  test('name is optional (only template is required)', () => {
    expect(UploadTemplateSchema.safeParse({ template: 'data' }).success).toBe(true);
  });

  test('name, comment and category: 200 characters accepted, 201 rejected', () => {
    for (const field of ['name', 'comment', 'category']) {
      expect(UploadTemplateSchema.safeParse({ template: 'data', [field]: 'x'.repeat(200) }).success, field).toBe(true);
      expect(UploadTemplateSchema.safeParse({ template: 'data', [field]: 'x'.repeat(201) }).success, field).toBe(false);
    }
  });

  test('sample: one partial item accepted', () => {
    const result = UploadTemplateSchema.parse({ template: 'data', sample: [{ data: { name: 'Acme' } }] });
    expect(result.sample).toEqual([{ data: { name: 'Acme' } }]);
    expect(UploadTemplateSchema.safeParse({ template: 'data', sample: [{}] }).success).toBe(true);
  });

  test('sample: two items rejected (maxItems 1)', () => {
    expect(UploadTemplateSchema.safeParse({ template: 'data', sample: [{ data: {} }, { data: {} }] }).success).toBe(false);
  });

  test('sample: an unknown key rejected (additionalProperties: false)', () => {
    expect(UploadTemplateSchema.safeParse({ template: 'data', sample: [{ data: {}, extra: {} }] }).success).toBe(false);
  });

  test('expireAt: 0 accepted (never expires), negative rejected', () => {
    expect(UploadTemplateSchema.safeParse({ template: 'data', expireAt: 0 }).success).toBe(true);
    expect(UploadTemplateSchema.safeParse({ template: 'data', expireAt: -1 }).success).toBe(false);
  });
});

describe('UpdateTemplateSchema', () => {
  test('accepts templateId only', () => {
    const result = UpdateTemplateSchema.parse({ templateId: 'tpl1' });
    expect(result.templateId).toBe('tpl1');
  });

  test('accepts all optional fields', () => {
    const result = UpdateTemplateSchema.parse({
      templateId: 'tpl1',
      name: 'New Name',
      category: 'legal',
      tags: ['v2'],
      deployedAt: 1700000000,
      expireAt: 1800000000,
    });
    expect(result.deployedAt).toBe(1700000000);
    expect(result.expireAt).toBe(1800000000);
  });

  test('rejects empty templateId', () => {
    expect(() => UpdateTemplateSchema.parse({ templateId: '' })).toThrow();
  });

  test('rejects non-integer timestamps', () => {
    expect(() =>
      UpdateTemplateSchema.parse({ templateId: 'tpl1', deployedAt: 1.5 })
    ).toThrow();
  });

  test('accepts moveToTemplateId (move to another Template ID) and expireAt: 0 (cancel a scheduled deletion)', () => {
    const result = UpdateTemplateSchema.parse({ templateId: 'sha-v1', moveToTemplateId: '1234567890', expireAt: 0 });
    expect(result).toMatchObject({ moveToTemplateId: '1234567890', expireAt: 0 });
  });

  test('rejects a negative expireAt', () => {
    expect(UpdateTemplateSchema.safeParse({ templateId: 'tpl1', expireAt: -1 }).success).toBe(false);
  });

  test('accepts the deprecated id alias, alone or matching moveToTemplateId; rejects a mismatch', () => {
    expect(UpdateTemplateSchema.safeParse({ templateId: 'sha-v1', id: '123' }).success).toBe(true);
    expect(UpdateTemplateSchema.safeParse({ templateId: 'sha-v1', id: '123', moveToTemplateId: '123' }).success).toBe(true);
    expect(UpdateTemplateSchema.safeParse({ templateId: 'sha-v1', id: '123', moveToTemplateId: '456' }).success).toBe(false);
  });

  test('name, comment and category: 200 characters accepted, 201 rejected', () => {
    for (const field of ['name', 'comment', 'category']) {
      expect(UpdateTemplateSchema.safeParse({ templateId: 'tpl1', [field]: 'x'.repeat(200) }).success, field).toBe(true);
      expect(UpdateTemplateSchema.safeParse({ templateId: 'tpl1', [field]: 'x'.repeat(201) }).success, field).toBe(false);
    }
  });
});

describe('DeleteTemplateSchema', () => {
  test('accepts valid templateId', () => {
    const result = DeleteTemplateSchema.parse({ templateId: 'tpl1' });
    expect(result.templateId).toBe('tpl1');
  });

  test('rejects empty templateId', () => {
    expect(() => DeleteTemplateSchema.parse({ templateId: '' })).toThrow();
  });
});

describe('DownloadTemplateSchema', () => {
  test('accepts valid templateId', () => {
    const result = DownloadTemplateSchema.parse({ templateId: 'tpl1' });
    expect(result.templateId).toBe('tpl1');
  });

  test('rejects empty templateId', () => {
    expect(() => DownloadTemplateSchema.parse({ templateId: '' })).toThrow();
  });
});
