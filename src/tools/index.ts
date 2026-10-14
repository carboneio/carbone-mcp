import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CarboneClient } from '../carbone/client.js';
import type { FileContext } from './output.js';
import type { IoModes } from './inputForms.js';

import {
  convertDocumentToolName,
  convertDocumentDescription,
  convertDocumentSchemaFor,
  handleConvertDocument,
} from './convert.js';

import {
  renderDocumentToolName,
  renderDocumentDescription,
  renderDocumentSchemaFor,
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
  uploadTemplateSchemaFor,
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
  downloadTemplateSchemaFor,
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
  // Schema wording follows the transport: local paths only resolve in stdio, so on HTTP the
  // descriptions must not offer them (see inputForms.ts).
  const io: IoModes = { allowLocalPath: fileCtx.allowFileInput, allowFileOutput: fileCtx.allowFileOutput };

  // Annotations are hints (not security boundaries): they let clients show safe/destructive
  // badges and help models reason about which tools are read-only, repeatable, or destructive.
  // - readOnlyHint:   does not modify stored state (generation/listing/status).
  // - idempotentHint: same args produce the same effect when repeated.
  // - destructiveHint: only meaningful when readOnlyHint is false; true for delete.
  // - openWorldHint:  calls the external Carbone API (false only for the local capabilities tool).
  //
  // The tools that return a document (render, convert, download_template) write a local file in stdio
  // (outputPath, or a fresh temp file by default), so they are not read-only there: each call may create
  // a new file (not idempotent), but never overwrites one (not destructive). Over HTTP they write nothing.
  const documentToolHints = fileCtx.allowFileOutput
    ? { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    : { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

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
      inputSchema: convertDocumentSchemaFor(io),
      annotations: documentToolHints,
    },
    (args, extra) => handleConvertDocument(args, client, { apiKey: extra.authInfo?.token }, fileCtx)
  );

  server.registerTool(
    renderDocumentToolName,
    {
      title: 'Generate Document',
      description: renderDocumentDescription,
      inputSchema: renderDocumentSchemaFor(io),
      annotations: documentToolHints,
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
      inputSchema: uploadTemplateSchemaFor(io),
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
      inputSchema: downloadTemplateSchemaFor(io),
      annotations: documentToolHints,
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
    () => handleGetCapabilities(io)
  );
}
