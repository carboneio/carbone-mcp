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

  test('accepts all converter values', () => {
    for (const converter of ['L', 'O', 'C'] as const) {
      const result = ConvertDocumentSchema.parse({
        file: 'base64data',
        convertTo: 'pdf',
        converter,
      });
      expect(result.converter).toBe(converter);
    }
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
