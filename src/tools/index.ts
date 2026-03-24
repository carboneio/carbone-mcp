import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CarboneClient } from '../carbone/client.js';

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
  handleListTemplates,
  listCategoriesToolName,
  listCategoriesDescription,
  handleListCategories,
  listTagsToolName,
  listTagsDescription,
  handleListTags,
  uploadTemplateToolName,
  uploadTemplateDescription,
  uploadTemplateSchema,
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
  handleGetApiStatus,
  getCapabilitiesToolName,
  getCapabilitiesDescription,
  handleGetCapabilities,
} from './info.js';

export function registerTools(server: McpServer, client: CarboneClient): void {
  server.registerTool(
    listTemplatesToolName,
    { description: listTemplatesDescription, inputSchema: listTemplatesSchema },
    (args, extra) => handleListTemplates(args, client, { apiKey: extra.authInfo?.token })
  );

  server.registerTool(
    convertDocumentToolName,
    { description: convertDocumentDescription, inputSchema: convertDocumentSchema },
    (args, extra) => handleConvertDocument(args, client, { apiKey: extra.authInfo?.token })
  );

  server.registerTool(
    renderDocumentToolName,
    { description: renderDocumentDescription, inputSchema: renderDocumentSchema },
    (args, extra) => handleRenderDocument(args, client, { apiKey: extra.authInfo?.token })
  );

  server.registerTool(
    listCategoriesToolName,
    { description: listCategoriesDescription },
    (extra) => handleListCategories({} as never, client, { apiKey: extra.authInfo?.token })
  );

  server.registerTool(
    listTagsToolName,
    { description: listTagsDescription },
    (extra) => handleListTags({} as never, client, { apiKey: extra.authInfo?.token })
  );

  server.registerTool(
    uploadTemplateToolName,
    { description: uploadTemplateDescription, inputSchema: uploadTemplateSchema },
    (args, extra) => handleUploadTemplate(args, client, { apiKey: extra.authInfo?.token })
  );

  server.registerTool(
    updateTemplateMetadataToolName,
    { description: updateTemplateMetadataDescription, inputSchema: updateTemplateMetadataSchema },
    (args, extra) => handleUpdateTemplateMetadata(args, client, { apiKey: extra.authInfo?.token })
  );

  server.registerTool(
    deleteTemplateToolName,
    { description: deleteTemplateDescription, inputSchema: deleteTemplateSchema },
    (args, extra) => handleDeleteTemplate(args, client, { apiKey: extra.authInfo?.token })
  );

  server.registerTool(
    downloadTemplateToolName,
    { description: downloadTemplateDescription, inputSchema: downloadTemplateSchema },
    (args, extra) => handleDownloadTemplate(args, client, { apiKey: extra.authInfo?.token })
  );

  server.registerTool(
    getApiStatusToolName,
    { description: getApiStatusDescription },
    (extra) => handleGetApiStatus(client, { apiKey: extra.authInfo?.token })
  );

  server.registerTool(
    getCapabilitiesToolName,
    { description: getCapabilitiesDescription },
    () => handleGetCapabilities()
  );
}
