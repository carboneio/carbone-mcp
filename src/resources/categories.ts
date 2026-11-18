import type { CarboneClient, CallOptions } from '../carbone/client.js';

export const CATEGORIES_URI = 'carbone://categories';

export const categoriesResourceDescription =
  'The template categories in use, such as "invoices" or "legal": the category filter of list_templates and upload_template.';

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
