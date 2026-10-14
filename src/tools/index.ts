import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
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
  updateTemplateMetadataOutputSchema,
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

// Tool schemas wrapped with z.object() once, at module scope: registerTools() runs for every HTTP request
// (a fresh McpServer each time), and the SDK deprecates passing raw shapes to registerTool.
const listTemplatesInput           = z.object(listTemplatesSchema);
const listTemplatesOutput          = z.object(listTemplatesOutputSchema);
const convertDocumentInput         = z.object(convertDocumentSchema);
const renderDocumentInput          = z.object(renderDocumentSchema);
const listCategoriesOutput         = z.object(listCategoriesOutputSchema);
const listTagsOutput               = z.object(listTagsOutputSchema);
const uploadTemplateInput          = z.object(uploadTemplateSchema);
const uploadTemplateOutput         = z.object(uploadTemplateOutputSchema);
const updateTemplateMetadataInput  = z.object(updateTemplateMetadataSchema);
const updateTemplateMetadataOutput = z.object(updateTemplateMetadataOutputSchema);
const deleteTemplateInput          = z.object(deleteTemplateSchema);
const downloadTemplateInput        = z.object(downloadTemplateSchema);
const getApiStatusOutput           = z.object(getApiStatusOutputSchema);

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
      inputSchema: listTemplatesInput,
      outputSchema: listTemplatesOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args, ctx) => handleListTemplates(args, client, { apiKey: ctx.http?.authInfo?.token, signal: ctx.mcpReq.signal })
  );

  server.registerTool(
    convertDocumentToolName,
    {
      title: 'Convert Document',
      description: convertDocumentDescription,
      inputSchema: convertDocumentInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args, ctx) => handleConvertDocument(args, client, { apiKey: ctx.http?.authInfo?.token, signal: ctx.mcpReq.signal }, fileCtx)
  );

  server.registerTool(
    renderDocumentToolName,
    {
      title: 'Generate Document',
      description: renderDocumentDescription,
      inputSchema: renderDocumentInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args, ctx) => handleRenderDocument(args, client, { apiKey: ctx.http?.authInfo?.token, signal: ctx.mcpReq.signal }, fileCtx)
  );

  server.registerTool(
    listCategoriesToolName,
    {
      title: 'List Categories',
      description: listCategoriesDescription,
      outputSchema: listCategoriesOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (ctx) => handleListCategories({} as never, client, { apiKey: ctx.http?.authInfo?.token, signal: ctx.mcpReq.signal })
  );

  server.registerTool(
    listTagsToolName,
    {
      title: 'List Tags',
      description: listTagsDescription,
      outputSchema: listTagsOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (ctx) => handleListTags({} as never, client, { apiKey: ctx.http?.authInfo?.token, signal: ctx.mcpReq.signal })
  );

  server.registerTool(
    uploadTemplateToolName,
    {
      title: 'Upload Template',
      description: uploadTemplateDescription,
      inputSchema: uploadTemplateInput,
      outputSchema: uploadTemplateOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args, ctx) => handleUploadTemplate(args, client, { apiKey: ctx.http?.authInfo?.token, signal: ctx.mcpReq.signal }, fileCtx)
  );

  server.registerTool(
    updateTemplateMetadataToolName,
    {
      title: 'Update Template Metadata',
      description: updateTemplateMetadataDescription,
      inputSchema: updateTemplateMetadataInput,
      outputSchema: updateTemplateMetadataOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args, ctx) => handleUpdateTemplateMetadata(args, client, { apiKey: ctx.http?.authInfo?.token, signal: ctx.mcpReq.signal })
  );

  server.registerTool(
    deleteTemplateToolName,
    {
      title: 'Delete Template',
      description: deleteTemplateDescription,
      inputSchema: deleteTemplateInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args, ctx) => handleDeleteTemplate(args, client, { apiKey: ctx.http?.authInfo?.token, signal: ctx.mcpReq.signal })
  );

  server.registerTool(
    downloadTemplateToolName,
    {
      title: 'Download Template',
      description: downloadTemplateDescription,
      inputSchema: downloadTemplateInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args, ctx) => handleDownloadTemplate(args, client, { apiKey: ctx.http?.authInfo?.token, signal: ctx.mcpReq.signal }, fileCtx)
  );

  server.registerTool(
    getApiStatusToolName,
    {
      title: 'API Status',
      description: getApiStatusDescription,
      outputSchema: getApiStatusOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (ctx) => handleGetApiStatus(client, { apiKey: ctx.http?.authInfo?.token, signal: ctx.mcpReq.signal })
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
