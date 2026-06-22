import { describe, test, expect, vi } from 'vitest';
import { readTemplatesResource, readTemplateByIdResource, completeTemplateId } from '../../../src/resources/templates.js';
import { readCategoriesResource } from '../../../src/resources/categories.js';
import { readTagsResource } from '../../../src/resources/tags.js';
import { readStatusResource } from '../../../src/resources/status.js';
import type { CarboneClient } from '../../../src/carbone/client.js';

/** Minimal stub exposing only the client methods the resources call. */
function makeClient() {
  return {
    listTemplates: vi.fn().mockResolvedValue({ templates: [], hasMore: false }),
    getCategories: vi.fn().mockResolvedValue([]),
    getTags: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn().mockResolvedValue({ version: '5', message: 'OK' }),
  } as unknown as CarboneClient;
}

describe('resource handlers forward the per-call apiKey (HTTP multi-tenant)', () => {
  test('readTemplatesResource lists up to 100 templates and forwards the token (browse-only)', async () => {
    const client = makeClient();
    await readTemplatesResource(new URL('carbone://templates'), client, { apiKey: 'tok-1' });
    expect(client.listTemplates).toHaveBeenCalledWith({ limit: 100 }, { apiKey: 'tok-1' });
  });

  test('readTemplateByIdResource filters by id for a Template ID and forwards the token', async () => {
    const client = makeClient();
    await readTemplateByIdResource(new URL('carbone://templates/abc'), 'abc', client, { apiKey: 'tok-id' });
    expect(client.listTemplates).toHaveBeenCalledWith({ id: 'abc', includeVersions: true }, { apiKey: 'tok-id' });
  });

  test('readTemplateByIdResource filters by versionId for a SHA-256', async () => {
    const client = makeClient();
    const sha = 'a'.repeat(64);
    await readTemplateByIdResource(new URL(`carbone://templates/${sha}`), sha, client, { apiKey: 'tok-v' });
    expect(client.listTemplates).toHaveBeenCalledWith({ versionId: sha, includeVersions: true }, { apiKey: 'tok-v' });
  });

  test('readCategoriesResource forwards the token to getCategories', async () => {
    const client = makeClient();
    await readCategoriesResource(new URL('carbone://categories'), client, { apiKey: 'tok-3' });
    expect(client.getCategories).toHaveBeenCalledWith({ apiKey: 'tok-3' });
  });

  test('readTagsResource forwards the token to getTags', async () => {
    const client = makeClient();
    await readTagsResource(new URL('carbone://tags'), client, { apiKey: 'tok-4' });
    expect(client.getTags).toHaveBeenCalledWith({ apiKey: 'tok-4' });
  });

  test('readStatusResource forwards the token to getStatus', async () => {
    const client = makeClient();
    await readStatusResource(new URL('carbone://status'), client, { apiKey: 'tok-5' });
    expect(client.getStatus).toHaveBeenCalledWith({ apiKey: 'tok-5' });
  });

  test('stdio mode: no options → client receives undefined apiKey (constructor key is used)', async () => {
    const client = makeClient();
    await readCategoriesResource(new URL('carbone://categories'), client);
    expect(client.getCategories).toHaveBeenCalledWith(undefined);
  });
});

describe('completeTemplateId', () => {
  test('returns Template IDs matching the partial value', async () => {
    const client = {
      listTemplates: vi.fn().mockResolvedValue({
        templates: [{ id: 'inv-1' }, { id: 'inv-2' }, { id: 'rep-9' }],
        hasMore: false,
      }),
    } as unknown as CarboneClient;

    expect(await completeTemplateId('inv', client)).toEqual(['inv-1', 'inv-2']);
  });

  test('degrades to [] when listing fails (e.g. no auth token in HTTP mode)', async () => {
    const client = {
      listTemplates: vi.fn().mockRejectedValue(new Error('unauthorized')),
    } as unknown as CarboneClient;

    expect(await completeTemplateId('x', client)).toEqual([]);
  });
});
