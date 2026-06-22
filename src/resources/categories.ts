import type { CarboneClient, CallOptions } from '../carbone/client.js';

export const CATEGORIES_URI = 'carbone://categories';

export const categoriesResourceDescription =
  'List all template categories currently in use in your Carbone account. ' +
  'Categories act like folders for organising templates (e.g. "invoices", "legal", "hr"). ' +
  'Use the returned names as the category filter in carbone://templates or the list_templates / upload_template tools.';

export async function readCategoriesResource(
  uri: URL,
  client: CarboneClient,
  options?: CallOptions
) {
  const categories = await client.getCategories(options);

  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(categories),
      },
    ],
  };
}
