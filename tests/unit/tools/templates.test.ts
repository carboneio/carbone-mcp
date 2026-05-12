import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/utils/file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/file.js')>();
  return { ...actual, resolveFileInput: vi.fn() };
});

import {
  handleListTemplates,
  handleListCategories,
  handleListTags,
  handleUploadTemplate,
  handleUpdateTemplateMetadata,
  handleDeleteTemplate,
  handleDownloadTemplate,
} from '../../../src/tools/templates.js';
import { resolveFileInput } from '../../../src/utils/file.js';
import type { CarboneClient } from '../../../src/carbone/client.js';
import { CarboneNotFoundError, CarboneError } from '../../../src/carbone/errors.js';

// ─── handleListTemplates ─────────────────────────────────────────────────────

describe('handleListTemplates', () => {
  const mockClient = { listTemplates: vi.fn() } as unknown as CarboneClient;

  beforeEach(() => vi.clearAllMocks());

  test('returns JSON list of templates', async () => {
    const templates = [{ id: 'abc', versionId: 'sha256abc', name: 'Invoice' }];
    vi.mocked(mockClient.listTemplates).mockResolvedValueOnce({ templates, hasMore: false });

    const result = await handleListTemplates({}, mockClient);

    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(JSON.parse(result.content[0].text)).toEqual(templates);
    }
  });

  test('appends next-page instruction when hasMore is true', async () => {
    const templates = [{ id: 'abc', versionId: 'sha256abc', name: 'Invoice' }];
    vi.mocked(mockClient.listTemplates).mockResolvedValueOnce({ templates, hasMore: true, nextCursor: 'cursor123' });

    const result = await handleListTemplates({}, mockClient);

    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain('cursor="cursor123"');
    }
  });

  test('does not append pagination hint when hasMore is false', async () => {
    const templates = [{ id: 'abc', versionId: 'sha256abc', name: 'Invoice' }];
    vi.mocked(mockClient.listTemplates).mockResolvedValueOnce({ templates, hasMore: false });

    const result = await handleListTemplates({}, mockClient);

    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).not.toContain('cursor');
    }
  });

  test('second page uses cursor from first response and returns no pagination hint', async () => {
    const page1 = [{ id: 'abc', versionId: 'sha256abc', name: 'Invoice' }];
    const page2 = [{ id: 'def', versionId: 'sha256def', name: 'Contract' }];
    vi.mocked(mockClient.listTemplates)
      .mockResolvedValueOnce({ templates: page1, hasMore: true,  nextCursor: 'cursor123' })
      .mockResolvedValueOnce({ templates: page2, hasMore: false });

    const result1 = await handleListTemplates({}, mockClient);
    expect(result1.content[0].type).toBe('text');
    if (result1.content[0].type === 'text') {
      expect(result1.content[0].text).toContain('cursor="cursor123"');
    }

    const result2 = await handleListTemplates({ cursor: 'cursor123' }, mockClient);
    expect(vi.mocked(mockClient.listTemplates)).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor123' }),
      undefined
    );
    expect(result2.content[0].type).toBe('text');
    if (result2.content[0].type === 'text') {
      expect(result2.content[0].text).not.toContain('cursor=');
      expect(JSON.parse(result2.content[0].text)).toEqual(page2);
    }
  });

  test('passes all filters to client', async () => {
    vi.mocked(mockClient.listTemplates).mockResolvedValueOnce({ templates: [], hasMore: false });

    await handleListTemplates(
      { category: 'invoices', search: 'inv', limit: 5, cursor: 'abc', origin: 0, includeVersions: true },
      mockClient
    );

    expect(vi.mocked(mockClient.listTemplates)).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'invoices', search: 'inv', limit: 5 }),
      undefined
    );
  });

  test('returns "No templates found." when list is empty', async () => {
    vi.mocked(mockClient.listTemplates).mockResolvedValueOnce({ templates: [], hasMore: false });

    const result = await handleListTemplates({}, mockClient);

    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toBe('No templates found.');
    }
  });

  test('forwards options to client.listTemplates', async () => {
    vi.mocked(mockClient.listTemplates).mockResolvedValueOnce({ templates: [], hasMore: false });

    await handleListTemplates({}, mockClient, { apiKey: 'custom-key' });

    expect(vi.mocked(mockClient.listTemplates)).toHaveBeenCalledWith(
      expect.anything(),
      { apiKey: 'custom-key' }
    );
  });

  test('returns isError on client error', async () => {
    vi.mocked(mockClient.listTemplates).mockRejectedValueOnce(
      new CarboneNotFoundError('Not found')
    );

    const result = await handleListTemplates({}, mockClient);

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
  });
});

// ─── handleUploadTemplate ─────────────────────────────────────────────────────

describe('handleUploadTemplate', () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.mocked(resolveFileInput).mockResolvedValue('resolved-base64==');
  });

  const makeClient = (result: object) =>
    ({ uploadTemplate: vi.fn().mockResolvedValue(result) }) as unknown as CarboneClient;

  test('resolves template input before uploading', async () => {
    const client = makeClient({ id: 'tpl1', versionId: 'v1', type: 'docx', size: 1024 });
    await handleUploadTemplate({ template: '/path/invoice.docx', name: 'Invoice' }, client);

    expect(resolveFileInput).toHaveBeenCalledWith('/path/invoice.docx');
    expect(vi.mocked(client.uploadTemplate)).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'resolved-base64==' }),
      undefined
    );
  });

  test('formats versioned response with id and versionId', async () => {
    const client = makeClient({ id: 'tpl1', versionId: 'sha256abc', type: 'docx', size: 2048 });

    const result = await handleUploadTemplate(
      { template: 'base64data', name: 'Invoice Template' },
      client
    );

    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain('tpl1');
      expect(result.content[0].text).toContain('sha256abc');
      expect(result.content[0].text).toContain('Invoice Template');
    }
  });

  test('formats legacy response with templateId only', async () => {
    const client = makeClient({ templateId: 'sha256legacy' });

    const result = await handleUploadTemplate(
      { template: 'base64data', name: 'Legacy Template' },
      client
    );

    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain('sha256legacy');
    }
  });

  test('passes all optional fields to client', async () => {
    const client = makeClient({ id: 'tpl1', versionId: 'v1', type: 'docx', size: 0 });

    await handleUploadTemplate(
      {
        template: 'data',
        name: 'T',
        category: 'legal',
        comment: 'v2 release',
        tags: ['sales'],
        versioning: false,
        deployedAt: 42000000000,
        expireAt: 1800000000,
      },
      client
    );

    expect(vi.mocked(client.uploadTemplate)).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'legal',
        comment: 'v2 release',
        tags: ['sales'],
        versioning: false,
        deployedAt: 42000000000,
        expireAt: 1800000000,
      }),
      undefined
    );
  });

  test('returns isError on client error', async () => {
    const client = {
      uploadTemplate: vi.fn().mockRejectedValue(new CarboneError('Upload failed', 400)),
    } as unknown as CarboneClient;

    const result = await handleUploadTemplate(
      { template: 'data', name: 'T' },
      client
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
  });
});

// ─── handleUpdateTemplateMetadata ─────────────────────────────────────────────

describe('handleUpdateTemplateMetadata', () => {
  const makeClient = () =>
    ({ updateTemplate: vi.fn().mockResolvedValue(undefined) }) as unknown as CarboneClient;

  test('calls client.updateTemplate with args', async () => {
    const client = makeClient();
    await handleUpdateTemplateMetadata({ templateId: 'tpl1', name: 'New Name' }, client);

    expect(vi.mocked(client.updateTemplate)).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: 'tpl1', name: 'New Name' }),
      undefined
    );
  });

  test('returns success message', async () => {
    const client = makeClient();
    const result = await handleUpdateTemplateMetadata({ templateId: 'tpl1' }, client);

    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain('updated successfully');
    }
  });

  test('passes all optional fields to client', async () => {
    const client = makeClient();
    await handleUpdateTemplateMetadata(
      {
        templateId: 'tpl1',
        name: 'N',
        comment: 'C',
        category: 'legal',
        tags: ['v2'],
        deployedAt: 42000000000,
        expireAt: 1800000000,
      },
      client
    );

    expect(vi.mocked(client.updateTemplate)).toHaveBeenCalledWith(
      expect.objectContaining({
        comment: 'C',
        category: 'legal',
        tags: ['v2'],
        deployedAt: 42000000000,
        expireAt: 1800000000,
      }),
      undefined
    );
  });

  test('returns isError on client error', async () => {
    const client = {
      updateTemplate: vi.fn().mockRejectedValue(new CarboneNotFoundError('Template')),
    } as unknown as CarboneClient;

    const result = await handleUpdateTemplateMetadata({ templateId: 'tpl1' }, client);

    expect(result.isError).toBe(true);
  });
});

// ─── handleDeleteTemplate ─────────────────────────────────────────────────────

describe('handleDeleteTemplate', () => {
  const makeClient = () =>
    ({ deleteTemplate: vi.fn().mockResolvedValue(undefined) }) as unknown as CarboneClient;

  test('calls client.deleteTemplate with templateId', async () => {
    const client = makeClient();
    await handleDeleteTemplate({ templateId: 'tpl1' }, client);

    expect(vi.mocked(client.deleteTemplate)).toHaveBeenCalledWith('tpl1', undefined);
  });

  test('returns success message', async () => {
    const client = makeClient();
    const result = await handleDeleteTemplate({ templateId: 'tpl1' }, client);

    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain('deleted successfully');
    }
  });

  test('returns isError on client error', async () => {
    const client = {
      deleteTemplate: vi.fn().mockRejectedValue(new CarboneNotFoundError('Template')),
    } as unknown as CarboneClient;

    const result = await handleDeleteTemplate({ templateId: 'tpl1' }, client);

    expect(result.isError).toBe(true);
  });
});

// ─── handleListCategories ─────────────────────────────────────────────────────

describe('handleListCategories', () => {
  const makeClient = (categories: string[]) =>
    ({ getCategories: vi.fn().mockResolvedValue(categories) }) as unknown as CarboneClient;

  test('returns JSON list of categories', async () => {
    const client = makeClient(['invoices', 'legal', 'hr']);
    const result = await handleListCategories({} as never, client);

    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(JSON.parse(result.content[0].text)).toEqual(['invoices', 'legal', 'hr']);
    }
  });

  test('returns "No categories found." when list is empty', async () => {
    const client = makeClient([]);
    const result = await handleListCategories({} as never, client);

    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toBe('No categories found.');
    }
  });

  test('returns isError on client error', async () => {
    const client = {
      getCategories: vi.fn().mockRejectedValue(new CarboneError('Server error', 500)),
    } as unknown as CarboneClient;

    const result = await handleListCategories({} as never, client);

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
  });
});

// ─── handleListTags ───────────────────────────────────────────────────────────

describe('handleListTags', () => {
  const makeClient = (tags: string[]) =>
    ({ getTags: vi.fn().mockResolvedValue(tags) }) as unknown as CarboneClient;

  test('returns JSON list of tags', async () => {
    const client = makeClient(['sales', 'billing', 'v2']);
    const result = await handleListTags({} as never, client);

    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(JSON.parse(result.content[0].text)).toEqual(['sales', 'billing', 'v2']);
    }
  });

  test('returns "No tags found." when list is empty', async () => {
    const client = makeClient([]);
    const result = await handleListTags({} as never, client);

    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toBe('No tags found.');
    }
  });

  test('returns isError on client error', async () => {
    const client = {
      getTags: vi.fn().mockRejectedValue(new CarboneError('Server error', 500)),
    } as unknown as CarboneClient;

    const result = await handleListTags({} as never, client);

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
  });
});

// ─── handleDownloadTemplate ───────────────────────────────────────────────────

describe('handleDownloadTemplate', () => {
  const makeClient = (filename = 'template.docx') =>
    ({
      downloadTemplate: vi
        .fn()
        .mockResolvedValue({ buffer: Buffer.from('file content'), filename }),
    }) as unknown as CarboneClient;

  test('calls client.downloadTemplate with templateId', async () => {
    const client = makeClient();
    await handleDownloadTemplate({ templateId: 'tpl1' }, client);

    expect(vi.mocked(client.downloadTemplate)).toHaveBeenCalledWith('tpl1', undefined);
  });

  test('returns EmbeddedResource for DOCX download', async () => {
    const client = makeClient('invoice.docx');
    const result = await handleDownloadTemplate({ templateId: 'tpl1' }, client);

    expect(result.content[0].type).toBe('resource');
  });

  test('returns EmbeddedResource for PDF download', async () => {
    const client = makeClient('form.pdf');
    const result = await handleDownloadTemplate({ templateId: 'tpl1' }, client);

    expect(result.content[0].type).toBe('resource');
  });

  test('returns TextContent for HTML download', async () => {
    const client = makeClient('template.html');
    const result = await handleDownloadTemplate({ templateId: 'tpl1' }, client);

    expect(result.content[0].type).toBe('text');
  });

  test('returns isError on client error', async () => {
    const client = {
      downloadTemplate: vi.fn().mockRejectedValue(new CarboneNotFoundError('Template')),
    } as unknown as CarboneClient;

    const result = await handleDownloadTemplate({ templateId: 'tpl1' }, client);

    expect(result.isError).toBe(true);
  });
});
