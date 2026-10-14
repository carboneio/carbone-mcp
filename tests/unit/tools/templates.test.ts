import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/utils/file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/file.js')>();
  return { ...actual, resolveFileInput: vi.fn(), writeOutputFile: vi.fn() };
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
import { resolveFileInput, writeOutputFile } from '../../../src/utils/file.js';
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
    expect(result.structuredContent).toEqual({ templates, hasMore: false });
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
    expect(result.structuredContent).toEqual({ templates: [], hasMore: false });
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

    expect(resolveFileInput).toHaveBeenCalledWith(
      '/path/invoice.docx',
      expect.objectContaining({ isCloud: undefined, allowLocalPath: false, allowPrivateNetwork: false })
    );
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
    expect(result.structuredContent).toEqual({
      name: 'Invoice Template', id: 'tpl1', versionId: 'sha256abc', type: 'docx', size: 2048,
    });
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
    expect(result.structuredContent).toEqual({ name: 'Legacy Template', templateId: 'sha256legacy' });
  });

  test('surfaces createdAt and a deployed version (deployedAt > 0)', async () => {
    const client = makeClient({ id: 'tpl1', versionId: 'v1', type: 'docx', size: 10, createdAt: 1700000000, deployedAt: 1700000000 });
    const result = await handleUploadTemplate({ template: 'data', name: 'T' }, client);

    expect(result.structuredContent).toEqual({
      name: 'T', id: 'tpl1', versionId: 'v1', type: 'docx', size: 10, createdAt: 1700000000, deployedAt: 1700000000,
    });
    expect((result.content[0] as { text: string }).text).toContain('Deployed at : 1700000000');
  });

  test('deployedAt 0: says the version is not explicitly deployed and how to make it the one used', async () => {
    const client = makeClient({ id: 'tpl1', versionId: 'v2', type: 'docx', size: 10, createdAt: 1700000000, deployedAt: 0 });
    const result = await handleUploadTemplate({ template: 'data', id: 'tpl1' }, client);

    expect(result.structuredContent).toMatchObject({ versionId: 'v2', deployedAt: 0 });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('not explicitly deployed: if another version of this Template ID is deployed, renders by Template ID keep using it');
    expect(text).toContain('(templateId = this Version ID, deployedAt = 42000000000), or render it by its Version ID');
    // A fresh Template ID with deployedAt 0 still renders (verified live), so never claim the version is unusable.
    expect(text).not.toMatch(/not deployed\)|cannot|unusable/);
  });

  test('treats "deployedAt": null as absent (no structured field, no deployment line)', async () => {
    const client = makeClient({ id: 'tpl1', versionId: 'v1', type: 'docx', size: 10, createdAt: 1700000000, deployedAt: null });
    const result = await handleUploadTemplate({ template: 'data', name: 'T' }, client);

    expect(result.structuredContent).not.toHaveProperty('deployedAt');
    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain('Deployed at');
    expect(text).not.toContain('null');
  });

  test('surfaces templateExtension in legacy mode, and omits name when none was given', async () => {
    const client = makeClient({ templateId: 'sha256legacy', templateExtension: 'docx' });
    const result = await handleUploadTemplate({ template: 'data', versioning: false }, client);

    expect(result.structuredContent).toEqual({ templateId: 'sha256legacy', templateExtension: 'docx' });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Extension   : docx');
    expect(text).not.toContain('Name');
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
  const makeClient = (result: object = { versionId: 'sha-v1' }) =>
    ({ updateTemplate: vi.fn().mockResolvedValue(result) }) as unknown as CarboneClient;

  test('calls client.updateTemplate with args', async () => {
    const client = makeClient();
    await handleUpdateTemplateMetadata({ templateId: 'tpl1', name: 'New Name' }, client);

    expect(vi.mocked(client.updateTemplate)).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: 'tpl1', name: 'New Name' }),
      undefined
    );
  });

  test('returns a success message naming the patched version', async () => {
    const client = makeClient();
    const result = await handleUpdateTemplateMetadata({ templateId: 'tpl1' }, client);

    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toContain('Template metadata updated');
      expect(result.content[0].text).toContain('sha-v1');
    }
  });

  test('returns the patched versionId and echoed fields as structured content (unknown keys dropped)', async () => {
    const client = makeClient({ versionId: 'sha-v1', name: 'N', tags: ['a', 'b'], expireAt: 0, unexpected: true });
    const result = await handleUpdateTemplateMetadata({ templateId: 'tpl1', name: 'N', tags: ['b', 'a'], expireAt: 0 }, client);

    expect(result.structuredContent).toEqual({ versionId: 'sha-v1', name: 'N', tags: ['a', 'b'], expireAt: 0 });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('version sha-v1 (the currently deployed version of Template ID tpl1)');
    expect(text).toContain('"expireAt":0');
  });

  test('real API response: "deployedAt": null (not sent) is treated as absent', async () => {
    // Shape returned by api.carbone.io for a PATCH of name + category + tags (deployedAt not sent).
    const client = makeClient({
      name: 'BattleTest updated', category: 'bt-cat2', tags: ['bt', 'upd'], deployedAt: null, versionId: '4dc8abc',
    });
    const result = await handleUpdateTemplateMetadata(
      { templateId: '1530905183164918624', name: 'BattleTest updated', category: 'bt-cat2', tags: ['bt', 'upd'] },
      client
    );

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      versionId: '4dc8abc', name: 'BattleTest updated', category: 'bt-cat2', tags: ['bt', 'upd'],
    });
    expect((result.content[0] as { text: string }).text).not.toContain('null');
  });

  test('a Version ID in templateId is reported as that exact version', async () => {
    const client = makeClient({ versionId: 'sha-v2', deployedAt: 1700000000 });
    const result = await handleUpdateTemplateMetadata({ templateId: 'sha-v2', deployedAt: 42000000000 }, client);

    expect(result.structuredContent).toEqual({ versionId: 'sha-v2', deployedAt: 1700000000 });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('updated for version sha-v2.');
    expect(text).not.toContain('currently deployed');
  });

  test('passes all optional fields to client, mapping moveToTemplateId to the API field id', async () => {
    const client = makeClient();
    await handleUpdateTemplateMetadata(
      {
        templateId: 'sha-v1',
        moveToTemplateId: '1234567890',
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
        id: '1234567890',
        comment: 'C',
        category: 'legal',
        tags: ['v2'],
        deployedAt: 42000000000,
        expireAt: 1800000000,
      }),
      undefined
    );
    expect(vi.mocked(client.updateTemplate).mock.calls[0][0]).not.toHaveProperty('moveToTemplateId');
  });

  test('accepts the deprecated 1.6.0 id as an alias of moveToTemplateId', async () => {
    const client = makeClient();
    await handleUpdateTemplateMetadata({ templateId: 'sha-v1', id: '1234567890' }, client);

    expect(vi.mocked(client.updateTemplate)).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: 'sha-v1', id: '1234567890' }), undefined);
  });

  test('accepts id and moveToTemplateId together when they agree', async () => {
    const client = makeClient();
    const result = await handleUpdateTemplateMetadata(
      { templateId: 'sha-v1', id: '1234567890', moveToTemplateId: '1234567890' }, client);

    expect(result.isError).toBeUndefined();
    expect(vi.mocked(client.updateTemplate).mock.calls[0][0]).toMatchObject({ id: '1234567890' });
  });

  test('rejects id and moveToTemplateId with different values, without calling the API', async () => {
    const client = makeClient();
    const result = await handleUpdateTemplateMetadata(
      { templateId: 'sha-v1', id: '111', moveToTemplateId: '222' }, client);

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/moveToTemplateId "222" and id "111"/);
    expect(vi.mocked(client.updateTemplate)).not.toHaveBeenCalled();
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
    expect(result.structuredContent).toEqual({ categories: ['invoices', 'legal', 'hr'] });
  });

  test('returns "No categories found." when list is empty', async () => {
    const client = makeClient([]);
    const result = await handleListCategories({} as never, client);

    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toBe('No categories found.');
    }
    expect(result.structuredContent).toEqual({ categories: [] });
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
    expect(result.structuredContent).toEqual({ tags: ['sales', 'billing', 'v2'] });
  });

  test('returns "No tags found." when list is empty', async () => {
    const client = makeClient([]);
    const result = await handleListTags({} as never, client);

    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toBe('No tags found.');
    }
    expect(result.structuredContent).toEqual({ tags: [] });
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

    expect(vi.mocked(client.downloadTemplate)).toHaveBeenCalledWith(
      'tpl1', expect.objectContaining({ sample: false }));
  });

  test('sample:true requests the sample dataset', async () => {
    const client = makeClient();
    await handleDownloadTemplate({ templateId: 'tpl1', sample: true }, client);

    expect(vi.mocked(client.downloadTemplate)).toHaveBeenCalledWith(
      'tpl1', expect.objectContaining({ sample: true }));
  });

  test('returns EmbeddedResource for DOCX download', async () => {
    const client = makeClient('invoice.docx');
    const result = await handleDownloadTemplate({ templateId: 'tpl1' }, client);

    expect(result.content[0].type).toBe('resource');
  });

  test('saves to disk when outputPath is provided (stdio)', async () => {
    vi.mocked(writeOutputFile).mockResolvedValue({ path: '/tpl.docx', size: 100 });
    const client = makeClient('invoice.docx');

    const result = await handleDownloadTemplate(
      { templateId: 'tpl1', outputPath: '/tpl.docx' },
      client,
      undefined,
      { allowFileOutput: true, allowFileInput: true, allowPrivateNetwork: false, maxFileBytes: 100 }
    );

    expect(vi.mocked(writeOutputFile)).toHaveBeenCalledWith('/tpl.docx', expect.anything());
    expect((result.content[0] as { text: string }).text).toContain('/tpl.docx');
  });

  test('returns EmbeddedResource for PDF download', async () => {
    const client = makeClient('form.pdf');
    const result = await handleDownloadTemplate({ templateId: 'tpl1' }, client);

    expect(result.content[0].type).toBe('resource');
  });

  describe('sample download (returned filename without extension)', () => {
    const sampleClient = () => ({
      downloadTemplate: vi.fn().mockResolvedValue({ buffer: Buffer.from('[{"data":{"a":1}}]'), filename: 'document' }),
    }) as unknown as CarboneClient;
    const stdio = { allowFileOutput: true, allowFileInput: true, allowPrivateNetwork: false, maxFileBytes: 100 };

    test('sample:true is delivered inline as JSON text', async () => {
      const client = sampleClient();
      const result = await handleDownloadTemplate({ templateId: 'tpl1', sample: true }, client, undefined, stdio);

      expect(vi.mocked(client.downloadTemplate)).toHaveBeenCalledWith('tpl1', { sample: true });
      expect(result.content[0]).toEqual({ type: 'text', text: '[{"data":{"a":1}}]' });
    });

    test('a raw "<id>_sample.json" id is treated as sample:true (suffix not doubled)', async () => {
      const client = sampleClient();
      const result = await handleDownloadTemplate({ templateId: 'tpl1_sample.json', sample: true }, client, undefined, stdio);

      expect(vi.mocked(client.downloadTemplate)).toHaveBeenCalledWith('tpl1', { sample: true });
      expect(result.content[0]).toEqual({ type: 'text', text: '[{"data":{"a":1}}]' });
    });

    test('outputPath (stdio) saves it as json', async () => {
      vi.mocked(writeOutputFile).mockResolvedValue({ path: '/tmp/sample.json', size: 18 });
      const result = await handleDownloadTemplate(
        { templateId: 'tpl1', sample: true, outputPath: '/tmp/sample.json' }, sampleClient(), undefined, stdio
      );

      expect(vi.mocked(writeOutputFile)).toHaveBeenCalledWith('/tmp/sample.json', expect.any(Buffer));
      expect((result.content[0] as { text: string }).text).toBe('Document saved to /tmp/sample.json (18 bytes, json).');
    });

    test('asAttachment labels it application/json', async () => {
      const result = await handleDownloadTemplate(
        { templateId: 'tpl1', sample: true, asAttachment: true }, sampleClient(), undefined, stdio
      );

      expect(result.content[0]).toMatchObject({ type: 'resource', resource: { mimeType: 'application/json' } });
    });
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
