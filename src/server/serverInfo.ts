// Shared MCP server identity and usage instructions for both transports.

import { CARBONE_ICON_SVG, CARBONE_ICON_PNG } from './icons.js';

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
      { src: CARBONE_ICON_PNG, mimeType: 'image/png', sizes: ['85x96'] },
    ],
  };
}

/** Usage primer surfaced to the client/model via the initialize response (server options). */
export const SERVER_INSTRUCTIONS =
  'Carbone generates and converts documents (PDF, DOCX, XLSX, PPTX, ODT, HTML, Markdown, images, …) ' +
  'from templates and JSON data.\n\n' +
  '- Call get_capabilities for a full overview of tools, supported formats, and template syntax.\n' +
  '- Use convert_document to convert an existing file between formats (no data injection).\n' +
  '- Use render_document to merge JSON data into a Carbone template ({d.field} tags): pass a ' +
  'templateId for a stored template, or an inline template for a one-shot render.\n' +
  '- Writing, editing, or validating a Carbone template? Load the Carbone Skill first — Carbone tags are ' +
  'a unique language (NOT Mustache/Handlebars/Jinja), so never guess syntax; the Skill is the source of ' +
  'truth for tags, formatters, loops, and conditions: https://carbone.io/documentation/developer/ai/skills.md ' +
  '(get_capabilities links the loadable .skill file).\n' +
  '- Manage stored templates with upload_template, list_templates, update_template_metadata, ' +
  'download_template, and delete_template.\n' +
  '- File inputs accept a local path, an HTTPS URL, or a base64 string. In stdio (local) mode, pass ' +
  'outputPath to save large outputs to disk instead of returning them inline.\n' +
  '- Docs are LLM-friendly: replace .html with .md on any carbone.io doc URL for Markdown, or load ' +
  'https://carbone.io/llms.txt (index) / https://carbone.io/llms-full.txt (full corpus).';
