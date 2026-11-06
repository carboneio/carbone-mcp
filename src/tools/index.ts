import { z } from 'zod';
import type { McpServer, StandardSchemaWithJSON, ToolAnnotations } from '@modelcontextprotocol/server';
import { callOptionsFrom, type CarboneClient } from '../carbone/client.js';
import type { FileContext } from './output.js';
import type { IoModes } from './inputForms.js';
import { chatFileMeta } from './attachments.js';
import { uploadCallerFrom } from '../server/upload.js';
import { callerIdFrom } from '../server/caller.js';

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
  getRenderResultToolName,
  getRenderResultDescription,
  getRenderResultSchema,
  handleGetRenderResult,
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
  uploadTemplateDescriptionFor,
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
  downloadTemplateDescriptionFor,
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
// `id`, the 1.6.0 name of moveToTemplateId, is accepted but not listed (see withHiddenFields).
const updateTemplateMetadataFull   = z.object(updateTemplateMetadataSchema);
const updateTemplateMetadataInput  = withHiddenFields(updateTemplateMetadataFull, updateTemplateMetadataFull.omit({ id: true }));
const updateTemplateMetadataOutput = z.object(updateTemplateMetadataOutputSchema);
const deleteTemplateInput          = z.object(deleteTemplateSchema);
const getRenderResultInput         = z.object(getRenderResultSchema);
const getApiStatusOutput           = z.object(getApiStatusOutputSchema);
const inspectTemplateOutput        = z.object(inspectTemplateOutputSchema);

/**
 * A tool input schema that validates with `full` but is listed as `shown`: a field left out of `shown` is still
 * accepted when a call sends it, but tools/list never shows it. Models read tools/list, so they stop seeing a
 * deprecated field, while callers written against the old schema keep working. The SDK validates with
 * `~standard.validate` and builds the listed JSON Schema from `~standard.jsonSchema`.
 */
function withHiddenFields<T>(full: StandardSchemaWithJSON<T, T>, shown: StandardSchemaWithJSON): StandardSchemaWithJSON<T, T> {
  return { '~standard': { ...full['~standard'], jsonSchema: shown['~standard'].jsonSchema } };
}

/**
 * The file-handling tools word their inputs per transport: local paths only resolve in stdio, so over HTTP the
 * descriptions must not offer them, nor outputPath (see inputForms.ts). Each variant is built and wrapped once,
 * on first use, then cached: there are only two in practice (stdio, HTTP), whereas registerTools() runs per request.
 */
function buildTransportTools(io: IoModes) {
  // outputPath only works in stdio: over HTTP it is still accepted (the call gets the explanatory error) but not listed.
  // Typed as the full schema, so the handlers keep their argument types.
  const listed = <T extends z.ZodObject>(full: T): T =>
    io.allowFileOutput ? full : withHiddenFields(full as never, full.omit({ outputPath: true } as never) as never) as T;
  return {
    // download_template writes a local file in stdio (outputPath, or a fresh temp file by default), so it is not
    // read-only there: each call may create a new file (not idempotent), but never overwrites one. Over HTTP it
    // only reads the account.
    downloadToolHints: io.allowFileOutput
      ? { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
      : { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    convertDocumentDescription: convertDocumentDescriptionFor(io),
    convertDocumentInput:       listed(z.object(convertDocumentSchemaFor(io))),
    renderDocumentDescription:  renderDocumentDescriptionFor(io),
    renderDocumentInput:        listed(z.object(renderDocumentSchemaFor(io))),
    inspectTemplateDescription: inspectTemplateDescriptionFor(io),
    inspectTemplateInput:       z.object(inspectTemplateSchemaFor(io)),
    uploadTemplateDescription:  uploadTemplateDescriptionFor(io),
    uploadTemplateInput:        z.object(uploadTemplateSchemaFor(io)),
    downloadTemplateDescription: downloadTemplateDescriptionFor(io),
    downloadTemplateInput:      listed(z.object(downloadTemplateSchemaFor(io))),
    // Over HTTP, ChatGPT passes a file attached to the chat to these inputs (see attachments.ts).
    attachedFileMeta:           chatFileMeta(io, 'attachedFile'),
    attachedTemplateMeta:       chatFileMeta(io, 'attachedTemplate'),
  };
}

const transportTools = new Map<string, ReturnType<typeof buildTransportTools>>();

/** The cached transport-dependent descriptions and input schemas for these I/O modes (exported for tests). */
export function transportToolsFor(io: IoModes): ReturnType<typeof buildTransportTools> {
  const key = `${io.allowLocalPath}:${io.allowFileOutput}:${!!io.allowUploadUrl}:${!!io.allowAsync}`;
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

/** render_document and convert_document, on both transports (see the readOnlyHint note in registerTools). */
const generationHints: Hints = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

function titled(title: string, hints: Hints) {
  return { title, annotations: { title, ...hints } };
}

export function registerTools(server: McpServer, client: CarboneClient, fileCtx: FileContext): void {
  const io: IoModes = {
    allowLocalPath: fileCtx.allowFileInput, allowFileOutput: fileCtx.allowFileOutput,
    allowUploadUrl: !!fileCtx.uploads, allowAsync: !!fileCtx.jobs,
  };
  const {
    convertDocumentDescription, convertDocumentInput, renderDocumentDescription, renderDocumentInput,
    inspectTemplateDescription, inspectTemplateInput, uploadTemplateDescription, uploadTemplateInput,
    downloadTemplateDescription, downloadTemplateInput, downloadToolHints, attachedFileMeta, attachedTemplateMeta,
  } = transportToolsFor(io);

  // Annotations are hints (not security boundaries): they let clients show safe/destructive
  // badges and help models reason about which tools are read-only, repeatable, or destructive.
  // - readOnlyHint:   only reads or computes: creates, updates or deletes nothing, and sends no data outside the
  //   conversation (the OpenAI Apps definition). render and convert create a document at Carbone (counted, kept until
  //   downloaded), and render can post it to a webhook, so they are not read-only, nor idempotent.
  // - idempotentHint: same args produce the same effect when repeated.
  // - destructiveHint: only meaningful when readOnlyHint is false; true for delete, and for metadata updates,
  //   which overwrite fields and can schedule a deletion (expireAt).
  // - openWorldHint:  true for tools that reach beyond the user's Carbone account: render, convert, inspect and
  //   upload fetch user-supplied URLs, and render also downloads images listed in the data and can post the
  //   result to a webhookUrl. False for tools limited to the account, and for the local capabilities tool.
  // download_template takes per-transport hints (downloadToolHints, see buildTransportTools).

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
      ...titled('Convert Document', generationHints),
      description: convertDocumentDescription,
      inputSchema: convertDocumentInput,
      ...attachedFileMeta,
    },
    (args, ctx) => handleConvertDocument(args, client, callOptionsFrom(ctx), fileCtx)
  );

  server.registerTool(
    renderDocumentToolName,
    {
      ...titled('Generate Document', generationHints),
      description: renderDocumentDescription,
      inputSchema: renderDocumentInput,
      ...attachedTemplateMeta,
    },
    (args, ctx) => handleRenderDocument(args, client, callOptionsFrom(ctx), fileCtx, callerIdFrom(ctx))
  );

  // Async renders only (HTTP with MCP_TICKET_SECRET and a job store): reads a result, changes nothing.
  const { jobs } = fileCtx;
  if (jobs) {
    server.registerTool(
      getRenderResultToolName,
      {
        ...titled('Get Render Result', { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }),
        description: getRenderResultDescription,
        inputSchema: getRenderResultInput,
      },
      (args, ctx) => handleGetRenderResult(args, client, jobs, callerIdFrom(ctx))
    );
  }

  // Runs one render whose document is never fetched: nothing is written locally nor changed in the account,
  // so it is read-only and repeatable on both transports.
  server.registerTool(
    inspectTemplateToolName,
    {
      ...titled('Inspect Template', { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }),
      description: inspectTemplateDescription,
      inputSchema: inspectTemplateInput,
      ...attachedTemplateMeta,
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
      ...attachedTemplateMeta,
      outputSchema: uploadTemplateOutput,
    },
    (args, ctx) => handleUploadTemplate(args, client, callOptionsFrom(ctx), fileCtx, uploadCallerFrom(ctx))
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
      ...titled('Download Template', downloadToolHints),
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
