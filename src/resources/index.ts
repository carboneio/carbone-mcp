import { ResourceTemplate } from '@modelcontextprotocol/server';
import type { McpServer } from '@modelcontextprotocol/server';
import type { CarboneClient } from '../carbone/client.js';

import {
  TEMPLATES_URI, templatesResourceDescription, readTemplatesResource,
  TEMPLATE_BY_ID_URI_TEMPLATE, templateByIdResourceDescription, readTemplateByIdResource, completeTemplateId,
} from './templates.js';
import { CATEGORIES_URI, categoriesResourceDescription, readCategoriesResource } from './categories.js';
import { TAGS_URI, tagsResourceDescription, readTagsResource } from './tags.js';
import { STATUS_URI, statusResourceDescription, readStatusResource } from './status.js';

export function registerResources(server: McpServer, client: CarboneClient): void {
  // The Bearer token (HTTP mode) arrives on authInfo and is forwarded as the
  // per-call API key — mirroring registerTools — so resources work in multi-tenant
  // HTTP mode. In stdio mode authInfo is undefined and the constructor key is used.
  // Browse-all (static). MCP resources can't receive query strings, so filtering lives in the
  // list_templates tool; this resource just lists templates.
  server.registerResource(
    'carbone-templates',
    TEMPLATES_URI,
    { description: templatesResourceDescription, mimeType: 'application/json' },
    (uri, ctx) => readTemplatesResource(uri, client, { apiKey: ctx.http?.authInfo?.token })
  );

  // Parameterized: a single template by ID/version, with Template ID autocompletion. Completion
  // requests carry no auth token, so completeTemplateId degrades to no suggestions in HTTP mode.
  server.registerResource(
    'carbone-template',
    new ResourceTemplate(TEMPLATE_BY_ID_URI_TEMPLATE, {
      list: undefined,
      complete: { id: (value) => completeTemplateId(value, client) },
    }),
    { description: templateByIdResourceDescription, mimeType: 'application/json' },
    (uri, variables, ctx) =>
      readTemplateByIdResource(uri, String(variables['id']), client, { apiKey: ctx.http?.authInfo?.token })
  );

  server.registerResource(
    'carbone-categories',
    CATEGORIES_URI,
    { description: categoriesResourceDescription, mimeType: 'application/json' },
    (uri, ctx) => readCategoriesResource(uri, client, { apiKey: ctx.http?.authInfo?.token })
  );

  server.registerResource(
    'carbone-tags',
    TAGS_URI,
    { description: tagsResourceDescription, mimeType: 'application/json' },
    (uri, ctx) => readTagsResource(uri, client, { apiKey: ctx.http?.authInfo?.token })
  );

  server.registerResource(
    'carbone-status',
    STATUS_URI,
    { description: statusResourceDescription, mimeType: 'application/json' },
    (uri, ctx) => readStatusResource(uri, client, { apiKey: ctx.http?.authInfo?.token })
  );
}
