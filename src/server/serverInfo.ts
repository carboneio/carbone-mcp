// Shared MCP server identity, usage instructions and options for both transports.

import type { McpServerOptions } from '@modelcontextprotocol/server';
import { CARBONE_ICON_SVG, CARBONE_ICON_PNG } from './icons.js';
import { type IoModes, STDIO_IO } from '../tools/inputForms.js';

export function serverInfo(version: string) {
  return {
    name: 'carbone-mcp',
    version,
    title: 'Carbone',
    description:
      'Generate and convert documents (PDF, DOCX, XLSX, PPTX, ODT, HTML, Markdown, images) ' +
      'from templates and JSON data via the Carbone API.',
    websiteUrl: 'https://carbone.io',
    icons: [
      { src: CARBONE_ICON_SVG, mimeType: 'image/svg+xml', sizes: ['any'] },
      { src: CARBONE_ICON_PNG, mimeType: 'image/png', sizes: ['128x128'] },
    ],
  };
}

/**
 * Usage primer surfaced to the client/model via the initialize response. Kept short (clients that load tools on
 * demand read only names and instructions up front), and worded per transport like the tool descriptions.
 */
export function serverInstructionsFor(io: IoModes): string {
  return 'Carbone generates documents (PDF, DOCX, XLSX, PPTX, HTML, images...) from templates and JSON data, and ' +
    'converts files.\n\n' +
    '- convert_document changes a file\'s format; render_document merges JSON into a template ({d.field} tags).\n' +
    '- Unsure which data a template expects? Call inspect_template first.\n' +
    '- Carbone tags are their own language (not Mustache or Jinja): never guess the syntax. The Carbone Skill is the ' +
    'reference: https://carbone.io/documentation/developer/ai/skills.md\n' +
    (io.allowFileOutput
      ? '- Files: local paths, HTTPS URLs or base64. PDF and Office results are saved to a temp file.\n'
      : '- Files: HTTPS URLs or base64 (no local paths). PDF and Office results come back as a one-time download ' +
        'link: give it to the user as is, never open it yourself.\n') +
    (io.allowAsync ? '- Batches and long renders: render_document with async: true, then get_render_result.\n' : '') +
    (io.allowUploadUrl ? '- A large template: upload_template with requestUploadUrl, then send it with the curl command.\n' : '') +
    '- get_capabilities has the formats, converters, options and examples. Docs: https://carbone.io/llms.txt ' +
    '(replace .html with .md on any carbone.io doc URL).';
}

/** The stdio wording (also what tests and the default options use). */
export const SERVER_INSTRUCTIONS = serverInstructionsFor(STDIO_IO);

/**
 * Options for every McpServer instance, on both transports and both protocol eras. The tool and
 * resource lists are static, so `listChanged` is not advertised: a client then has no reason to keep
 * an idle change-notification stream (`subscriptions/listen`) open.
 */
export function serverOptionsFor(io: IoModes) {
  return {
    instructions: serverInstructionsFor(io),
    capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
  } satisfies McpServerOptions;
}

export const SERVER_OPTIONS = serverOptionsFor(STDIO_IO);
