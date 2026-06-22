import type { CarboneClient, CallOptions } from '../carbone/client.js';

export const TEMPLATES_URI = 'carbone://templates';

export const templatesResourceDescription =
  'Browse stored Carbone templates (up to 100, most recent first). ' +
  'For filtering by category/search/version/origin, includeVersions, or pagination, use the list_templates tool — ' +
  'MCP resources cannot receive query-string parameters.';

export async function readTemplatesResource(
  uri: URL,
  client: CarboneClient,
  options?: CallOptions
) {
  const templates = await client.listTemplates({ limit: 100 }, options);

  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(templates),
      },
    ],
  };
}

// ─── carbone://templates/{id} — a single template (all versions) ──────────────

export const TEMPLATE_BY_ID_URI_TEMPLATE = 'carbone://templates/{id}';

export const templateByIdResourceDescription =
  'Fetch a single stored template by its Template ID (64-bit) or Version ID (SHA-256), including its version history.';

export async function readTemplateByIdResource(
  uri: URL,
  id: string,
  client: CarboneClient,
  options?: CallOptions
) {
  // A Version ID is a 64-char SHA-256 hex string; a Template ID is a numeric 64-bit id. The Carbone
  // list API rejects a versionId passed as `id`, so route the identifier to the matching filter.
  const filter = /^[0-9a-f]{64}$/i.test(id)
    ? { versionId: id, includeVersions: true }
    : { id, includeVersions: true };
  const { templates } = await client.listTemplates(filter, options);

  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(templates),
      },
    ],
  };
}

/**
 * Autocomplete Template IDs for the {id} URI variable. Completion requests carry no auth token,
 * so this can only use the constructor-level key (stdio). In HTTP multi-tenant mode it degrades
 * gracefully to no suggestions rather than failing.
 */
export async function completeTemplateId(value: string, client: CarboneClient): Promise<string[]> {
  try {
    const { templates } = await client.listTemplates({ limit: 100 });
    return templates
      .map((t) => t.id)
      .filter((id): id is string => typeof id === 'string' && id.startsWith(value))
      .slice(0, 50);
  } catch {
    return [];
  }
}
