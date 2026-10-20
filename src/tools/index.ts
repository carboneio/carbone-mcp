import { z } from 'zod';
import type { McpServer, ToolAnnotations } from '@modelcontextprotocol/server';
import { callOptionsFrom, type CarboneClient } from '../carbone/client.js';
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
  inspectTemplateToolName,
  inspectTemplateDescriptionFor,
  inspectTemplateSchemaFor,
  inspectTemplateOutputSchema,
  handleInspectTemplate,
} from './inspect.js';

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
const inspectTemplateOutput        = z.object(inspectTemplateOutputSchema);

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
    inspectTemplateDescription: inspectTemplateDescriptionFor(io),
    inspectTemplateInput:       z.object(inspectTemplateSchemaFor(io)),
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

/**
 * A tool's title, repeated as annotations.title: clients read the top-level title, while Claude's connector
 * directory reads the display name from the annotation (MCP's earlier location for it). The three hints are
 * required, so every tool states them explicitly, as ChatGPT's plugin directory asks.
 */
type Hints = Omit<ToolAnnotations, 'title'> & Required<Pick<ToolAnnotations, 'readOnlyHint' | 'destructiveHint' | 'openWorldHint'>>;

function titled(title: string, hints: Hints) {
  return { title, annotations: { title, ...hints } };
}

export function registerTools(server: McpServer, client: CarboneClient, fileCtx: FileContext): void {
  const io: IoModes = { allowLocalPath: fileCtx.allowFileInput, allowFileOutput: fileCtx.allowFileOutput };
  const {
    convertDocumentDescription, convertDocumentInput, renderDocumentDescription, renderDocumentInput,
    inspectTemplateDescription, inspectTemplateInput, uploadTemplateInput, downloadTemplateInput, documentToolHints,
  } = transportToolsFor(io);

  // Annotations are hints (not security boundaries): they let clients show safe/destructive
  // badges and help models reason about which tools are read-only, repeatable, or destructive.
  // - readOnlyHint:   does not modify stored state (generation/listing/status).
  // - idempotentHint: same args produce the same effect when repeated.
  // - destructiveHint: only meaningful when readOnlyHint is false; true for delete, and for metadata updates,
  //   which overwrite fields and can schedule a deletion (expireAt).
  // - openWorldHint:  true for tools that reach beyond the user's Carbone account: render, convert, inspect and
  //   upload fetch user-supplied URLs, and render also downloads images listed in the data and can post the
  //   result to a webhookUrl. False for tools limited to the account, and for the local capabilities tool.
  // render, convert and download_template take per-transport hints (documentToolHints, see buildTransportTools).

  server.registerTool(
    listTemplatesToolName,
    {
      ...titled('List Templates', { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }),
      description: listTemplatesDescription,
      inputSchema: listTemplatesInput,
      outputSchema: listTemplatesOutput,
    },
    (args, ctx) => handleListTemplates(args, client, callOptionsFrom(ctx))
  );

  server.registerTool(
    convertDocumentToolName,
    {
      ...titled('Convert Document', documentToolHints),
      description: convertDocumentDescription,
      inputSchema: convertDocumentInput,
    },
    (args, ctx) => handleConvertDocument(args, client, callOptionsFrom(ctx), fileCtx)
  );

  server.registerTool(
    renderDocumentToolName,
    {
      ...titled('Generate Document', documentToolHints),
      description: renderDocumentDescription,
      inputSchema: renderDocumentInput,
    },
    (args, ctx) => handleRenderDocument(args, client, callOptionsFrom(ctx), fileCtx)
  );

  // Runs one render whose document is never fetched: nothing is written locally nor changed in the account,
  // so it is read-only and repeatable on both transports.
  server.registerTool(
    inspectTemplateToolName,
    {
      ...titled('Inspect Template', { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }),
      description: inspectTemplateDescription,
      inputSchema: inspectTemplateInput,
      outputSchema: inspectTemplateOutput,
    },
    (args, ctx) => handleInspectTemplate(args, client, callOptionsFrom(ctx), fileCtx)
  );

  server.registerTool(
    listCategoriesToolName,
    {
      ...titled('List Categories', { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }),
      description: listCategoriesDescription,
      outputSchema: listCategoriesOutput,
    },
    (ctx) => handleListCategories({} as never, client, callOptionsFrom(ctx))
  );

  server.registerTool(
    listTagsToolName,
    {
      ...titled('List Tags', { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }),
      description: listTagsDescription,
      outputSchema: listTagsOutput,
    },
    (ctx) => handleListTags({} as never, client, callOptionsFrom(ctx))
  );

  server.registerTool(
    uploadTemplateToolName,
    {
      ...titled('Upload Template', { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }),
      description: uploadTemplateDescription,
      inputSchema: uploadTemplateInput,
      outputSchema: uploadTemplateOutput,
    },
    (args, ctx) => handleUploadTemplate(args, client, callOptionsFrom(ctx), fileCtx)
  );

  server.registerTool(
    updateTemplateMetadataToolName,
    {
      ...titled('Update Template Metadata', { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }),
      description: updateTemplateMetadataDescription,
      inputSchema: updateTemplateMetadataInput,
      outputSchema: updateTemplateMetadataOutput,
    },
    (args, ctx) => handleUpdateTemplateMetadata(args, client, callOptionsFrom(ctx))
  );

  server.registerTool(
    deleteTemplateToolName,
    {
      ...titled('Delete Template', { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }),
      description: deleteTemplateDescription,
      inputSchema: deleteTemplateInput,
    },
    (args, ctx) => handleDeleteTemplate(args, client, callOptionsFrom(ctx))
  );

  server.registerTool(
    downloadTemplateToolName,
    {
      ...titled('Download Template', { ...documentToolHints, openWorldHint: false }),
      description: downloadTemplateDescription,
      inputSchema: downloadTemplateInput,
    },
    (args, ctx) => handleDownloadTemplate(args, client, callOptionsFrom(ctx), fileCtx)
  );

  server.registerTool(
    getApiStatusToolName,
    {
      ...titled('API Status', { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }),
      description: getApiStatusDescription,
      outputSchema: getApiStatusOutput,
    },
    (ctx) => handleGetApiStatus(client, callOptionsFrom(ctx))
  );

  server.registerTool(
    getCapabilitiesToolName,
    {
      ...titled('Capabilities', { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }),
      description: getCapabilitiesDescription,
    },
    () => handleGetCapabilities(io)
  );
}
