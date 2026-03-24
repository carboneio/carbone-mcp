import type { CarboneClient } from '../carbone/client.js';

export const TEMPLATES_URI = 'carbone://templates';

export const templatesResourceDescription =
  'List stored Carbone templates with filtering, search, and pagination. ' +
  'Supports query parameters: ?category=invoices, ?search=invoice, ?limit=20, ' +
  '?id=<templateId>, ?versionId=<versionId>, ?origin=0|1, ?includeVersions=true, ?cursor=<cursor>. ' +
  'Use list_categories or list_tags to discover valid filter values.';

export async function readTemplatesResource(
  uri: URL,
  client: CarboneClient
) {
  const category = uri.searchParams.get('category') ?? undefined;
  const search = uri.searchParams.get('search') ?? undefined;
  const limitParam = uri.searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;

  const templates = await client.listTemplates({ category, search, limit });

  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(templates, null, 2),
      },
    ],
  };
}
