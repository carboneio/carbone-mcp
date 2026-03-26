import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CarboneClient } from '../carbone/client.js';

import { TEMPLATES_URI, templatesResourceDescription, readTemplatesResource } from './templates.js';
import { CATEGORIES_URI, categoriesResourceDescription, readCategoriesResource } from './categories.js';
import { TAGS_URI, tagsResourceDescription, readTagsResource } from './tags.js';
import { STATUS_URI, statusResourceDescription, readStatusResource } from './status.js';

export function registerResources(server: McpServer, client: CarboneClient): void {
  server.registerResource(
    'carbone-templates',
    TEMPLATES_URI,
    { description: templatesResourceDescription, mimeType: 'application/json' },
    (uri) => readTemplatesResource(uri, client)
  );

  server.registerResource(
    'carbone-categories',
    CATEGORIES_URI,
    { description: categoriesResourceDescription, mimeType: 'application/json' },
    (uri) => readCategoriesResource(uri, client)
  );

  server.registerResource(
    'carbone-tags',
    TAGS_URI,
    { description: tagsResourceDescription, mimeType: 'application/json' },
    (uri) => readTagsResource(uri, client)
  );

  server.registerResource(
    'carbone-status',
    STATUS_URI,
    { description: statusResourceDescription, mimeType: 'application/json' },
    (uri) => readStatusResource(uri, client)
  );
}
