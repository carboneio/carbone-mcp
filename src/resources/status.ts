import type { CarboneClient, CallOptions } from '../carbone/client.js';

export const STATUS_URI = 'carbone://status';

export const statusResourceDescription =
  'The Carbone API health and version.';

export async function readStatusResource(
  uri: URL,
  client: CarboneClient,
  options?: CallOptions
) {
  const status = await client.getStatus(options);

  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(status),
      },
    ],
  };
}
