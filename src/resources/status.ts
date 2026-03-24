import type { CarboneClient } from '../carbone/client.js';

export const STATUS_URI = 'carbone://status';

export const statusResourceDescription =
  'Check the Carbone API health status and current version.';

export async function readStatusResource(
  uri: URL,
  client: CarboneClient
) {
  const status = await client.getStatus();

  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(status, null, 2),
      },
    ],
  };
}
