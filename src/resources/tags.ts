import type { CarboneClient, CallOptions } from '../carbone/client.js';

export const TAGS_URI = 'carbone://tags';

export const tagsResourceDescription =
  'The tags in use across templates. To find the templates with a tag, keep the listed templates whose tags include it.';

export async function readTagsResource(
  uri: URL,
  client: CarboneClient,
  options?: CallOptions
) {
  const tags = await client.getTags(options);

  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(tags),
      },
    ],
  };
}
