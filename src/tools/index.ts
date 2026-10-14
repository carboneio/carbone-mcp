import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { CarboneClient } from '../carbone/client.js';
import type { FileContext } from './output.js';
import type { IoModes } from './inputForms.js';

import {
  convertDocumentToolName,
  convertDocumentDescriptionFor,
  convertDocumentSchemaFor,
  handleConvertDocument,
} from './convert.js';

import {
  renderDocumentToolName,
  renderDocumentDescriptionFor,
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
  updateTemplateMetadataOutputSchema,
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

// Tool schemas wrapped with z.object() once, at module scope: registerTools() runs for every HTTP request
// (a fresh McpServer each time), and the SDK deprecates passing raw shapes to registerTool.
const listTemplatesInput           = z.object(listTemplatesSchema);
const listTemplatesOutput          = z.object(listTemplatesOutputSchema);
const listCategoriesOutput         = z.object(listCategoriesOutputSchema);
const listTagsOutput               = z.object(listTagsOutputSchema);
const uploadTemplateOutput         = z.object(uploadTemplateOutputSchema);
const updateTemplateMetadataInput  = z.object(updateTemplateMetadataSchema);
const updateTemplateMetadataOutput = z.object(updateTemplateMetadataOutputSchema);
const deleteTemplateInput          = z.object(deleteTemplateSchema);
const getApiStatusOutput           = z.object(getApiStatusOutputSchema);

/**
 * The file-handling tools word their inputs per transport: local paths only resolve in stdio, so over HTTP the
 * descriptions must not offer them, nor outputPath (see inputForms.ts). Each variant is built and wrapped once,
 * on first use, then cached: there are only two in practice (stdio, HTTP), whereas registerTools() runs per request.
 */
function buildTransportTools(io: IoModes) {
  return {
    // The tools that return a document (render, convert, download_template) write a local file in stdio
    // (outputPath, or a fresh temp file by default), so they are not read-only there: each call may create
    // a new file (not idempotent), but never overwrites one (not destructive). Over HTTP they write nothing.
    documentToolHints: io.allowFileOutput
      ? { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
      : { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    convertDocumentDescription: convertDocumentDescriptionFor(io),
    convertDocumentInput:       z.object(convertDocumentSchemaFor(io)),
    renderDocumentDescription:  renderDocumentDescriptionFor(io),
    renderDocumentInput:        z.object(renderDocumentSchemaFor(io)),
    uploadTemplateInput:        z.object(uploadTemplateSchemaFor(io)),
    downloadTemplateInput:      z.object(downloadTemplateSchemaFor(io)),
  };
}

const transportTools = new Map<string, ReturnType<typeof buildTransportTools>>();

/** The cached transport-dependent descriptions and input schemas for these I/O modes (exported for tests). */
export function transportToolsFor(io: IoModes): ReturnType<typeof buildTransportTools> {
  const key = `${io.allowLocalPath}:${io.allowFileOutput}`;
  let tools = transportTools.get(key);
  if (!tools) {
    tools = buildTransportTools(io);
    transportTools.set(key, tools);
  }
  return tools;
}

export function registerTools(server: McpServer, client: CarboneClient, fileCtx: FileContext): void {
  const io: IoModes = { allowLocalPath: fileCtx.allowFileInput, allowFileOutput: fileCtx.allowFileOutput };
  const {
    convertDocumentDescription, convertDocumentInput, renderDocumentDescription, renderDocumentInput,
    uploadTemplateInput, downloadTemplateInput, documentToolHints,
  } = transportToolsFor(io);

  // Annotations are hints (not security boundaries): they let clients show safe/destructive
  // badges and help models reason about which tools are read-only, repeatable, or destructive.
  // - readOnlyHint:   does not modify stored state (generation/listing/status).
  // - idempotentHint: same args produce the same effect when repeated.
  // - destructiveHint: only meaningful when readOnlyHint is false; true for delete.
  // - openWorldHint:  calls the external Carbone API (false only for the local capabilities tool).
  // render, convert and download_template take per-transport hints (documentToolHints, see buildTransportTools).

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
      annotations: documentToolHints,
    },
    (args, ctx) => handleConvertDocument(args, client, { apiKey: ctx.http?.authInfo?.token, signal: ctx.mcpReq.signal }, fileCtx)
  );

  server.registerTool(
    renderDocumentToolName,
    {
      title: 'Generate Document',
      description: renderDocumentDescription,
      inputSchema: renderDocumentInput,
      annotations: documentToolHints,
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
      annotations: documentToolHints,
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
    () => handleGetCapabilities(io)
  );
}
