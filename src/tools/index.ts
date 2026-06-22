import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CarboneClient } from '../carbone/client.js';
import type { FileContext } from './output.js';

import {
  convertDocumentToolName,
  convertDocumentDescription,
  convertDocumentSchema,
  handleConvertDocument,
} from './convert.js';

import {
  renderDocumentToolName,
  renderDocumentDescription,
  renderDocumentSchema,
  handleRenderDocument,
} from './render.js';

import {
  listTemplatesToolName,
  listTemplatesDescription,
  listTemplatesSchema,
  listTemplatesOutputSchema,
  handleListTemplates,
  listCategoriesToolName,
  listCategoriesDescription,
  listCategoriesOutputSchema,
  handleListCategories,
  listTagsToolName,
  listTagsDescription,
  listTagsOutputSchema,
  handleListTags,
  uploadTemplateToolName,
  uploadTemplateDescription,
  uploadTemplateSchema,
  uploadTemplateOutputSchema,
  handleUploadTemplate,
  updateTemplateMetadataToolName,
  updateTemplateMetadataDescription,
  updateTemplateMetadataSchema,
  handleUpdateTemplateMetadata,
  deleteTemplateToolName,
  deleteTemplateDescription,
  deleteTemplateSchema,
  handleDeleteTemplate,
  downloadTemplateToolName,
  downloadTemplateDescription,
  downloadTemplateSchema,
  handleDownloadTemplate,
} from './templates.js';

import {
  getApiStatusToolName,
  getApiStatusDescription,
  getApiStatusOutputSchema,
  handleGetApiStatus,
  getCapabilitiesToolName,
  getCapabilitiesDescription,
  handleGetCapabilities,
} from './info.js';

export function registerTools(server: McpServer, client: CarboneClient, fileCtx: FileContext): void {
  // Annotations are hints (not security boundaries): they let clients show safe/destructive
  // badges and help models reason about which tools are read-only, repeatable, or destructive.
  // - readOnlyHint:   does not modify stored state (generation/listing/status).
  // - idempotentHint: same args produce the same effect when repeated.
  // - destructiveHint: only meaningful when readOnlyHint is false; true for delete.
  // - openWorldHint:  calls the external Carbone API (false only for the local capabilities tool).
  server.registerTool(
    listTemplatesToolName,
    {
      title: 'List Templates',
      description: listTemplatesDescription,
      inputSchema: listTemplatesSchema,
      outputSchema: listTemplatesOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args, extra) => handleListTemplates(args, client, { apiKey: extra.authInfo?.token })
  );

  server.registerTool(
    convertDocumentToolName,
    {
      title: 'Convert Document',
      description: convertDocumentDescription,
      inputSchema: convertDocumentSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args, extra) => handleConvertDocument(args, client, { apiKey: extra.authInfo?.token }, fileCtx)
  );

  server.registerTool(
    renderDocumentToolName,
    {
      title: 'Generate Document',
      description: renderDocumentDescription,
      inputSchema: renderDocumentSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args, extra) => handleRenderDocument(args, client, { apiKey: extra.authInfo?.token }, fileCtx)
  );

  server.registerTool(
    listCategoriesToolName,
    {
      title: 'List Categories',
      description: listCategoriesDescription,
      outputSchema: listCategoriesOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (extra) => handleListCategories({} as never, client, { apiKey: extra.authInfo?.token })
  );

  server.registerTool(
    listTagsToolName,
    {
      title: 'List Tags',
      description: listTagsDescription,
      outputSchema: listTagsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (extra) => handleListTags({} as never, client, { apiKey: extra.authInfo?.token })
  );

  server.registerTool(
    uploadTemplateToolName,
    {
      title: 'Upload Template',
      description: uploadTemplateDescription,
      inputSchema: uploadTemplateSchema,
      outputSchema: uploadTemplateOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args, extra) => handleUploadTemplate(args, client, { apiKey: extra.authInfo?.token }, fileCtx)
  );

  server.registerTool(
    updateTemplateMetadataToolName,
    {
      title: 'Update Template Metadata',
      description: updateTemplateMetadataDescription,
      inputSchema: updateTemplateMetadataSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args, extra) => handleUpdateTemplateMetadata(args, client, { apiKey: extra.authInfo?.token })
  );

  server.registerTool(
    deleteTemplateToolName,
    {
      title: 'Delete Template',
      description: deleteTemplateDescription,
      inputSchema: deleteTemplateSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args, extra) => handleDeleteTemplate(args, client, { apiKey: extra.authInfo?.token })
  );

  server.registerTool(
    downloadTemplateToolName,
    {
      title: 'Download Template',
      description: downloadTemplateDescription,
      inputSchema: downloadTemplateSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args, extra) => handleDownloadTemplate(args, client, { apiKey: extra.authInfo?.token }, fileCtx)
  );

  server.registerTool(
    getApiStatusToolName,
    {
      title: 'API Status',
      description: getApiStatusDescription,
      outputSchema: getApiStatusOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (extra) => handleGetApiStatus(client, { apiKey: extra.authInfo?.token })
  );

  server.registerTool(
    getCapabilitiesToolName,
    {
      title: 'Capabilities',
      description: getCapabilitiesDescription,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () => handleGetCapabilities()
  );
}
