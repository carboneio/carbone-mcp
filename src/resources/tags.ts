import type { CarboneClient } from '../carbone/client.js';

export const TAGS_URI = 'carbone://tags';

export const tagsResourceDescription =
  'List all tags currently used across templates in your Carbone account. ' +
  'Tags are free-form labels attached to templates (e.g. "sales", "billing", "v2"). ' +
  'Note: the Carbone API does not support filtering carbone://templates by tag — ' +
  'use this resource to discover tags, then filter client-side.';

export async function readTagsResource(
  uri: URL,
  client: CarboneClient
) {
  const tags = await client.getTags();

  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(tags, null, 2),
      },
    ],
  };
}
