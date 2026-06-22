import type { CarboneClient, CallOptions } from '../carbone/client.js';

export const STATUS_URI = 'carbone://status';

export const statusResourceDescription =
  'Check the Carbone API health status and current version.';

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
