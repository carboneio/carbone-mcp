import { z } from 'zod';
import type { CarboneClient, CallOptions } from '../carbone/client.js';
import { CONVERTERS, CONVERTER_DESCRIPTION, OUTPUT_FORMAT_DESCRIPTION, OutputFormatSchema } from '../validation/formats.js';
import { resolveFileInput } from '../utils/file.js';
import { deliver, type FileContext } from './output.js';
import { formatError } from '../utils/errors.js';

export const convertDocumentToolName = 'convert_document';

export const convertDocumentDescription =
  'Convert a document to another format without storing a template. ' +
  'Pure conversion: no data is sent, so Carbone tags such as {d.name} are kept as written. ' +
  'The source file can be a local path, a URL, or a base64 string. ' +
  'Use render_document instead when you need data injection ({d.field} tags), translations, or batch generation. ' +
  'Common conversions: ' +
  'DOCX → PDF (file: "report.docx", convertTo: "pdf"; add converter: "I" for the fastest conversion), ' +
  'XLSX → PDF (file: "data.xlsx", convertTo: "pdf"), ' +
  'PPTX → PDF (file: "slides.pptx", convertTo: "pdf"), ' +
  'HTML → PDF (file: "page.html", convertTo: "pdf", converter: "C" for full CSS/JS rendering), ' +
  'DOCX → HTML (file: "doc.docx", convertTo: "html"), ' +
  'XLSX → CSV (file: "sheet.xlsx", convertTo: "csv"), ' +
  'PDF → PNG (file: "doc.pdf", convertTo: "png"), ' +
  'PPTX → PNG (first slide as image), ' +
  'MD → PDF (file: "readme.md", convertTo: "pdf").';

export const convertDocumentSchema = {
  file: z
    .string()
    .min(1)
    .describe(
      'The document to convert. Three input forms are accepted: ' +
      '(1) Local file path — absolute or relative, e.g. "/home/user/report.docx" or "./invoice.xlsx". ' +
      '(2) HTTPS URL — the file is downloaded automatically, e.g. "https://example.com/file.pptx". ' +
      '(3) Base64-encoded string — the raw file content encoded as base64. ' +
      'Supported input formats: DOCX, DOC, XLSX, XLS, PPTX, PPT, PDF, ODT, ODS, ODP, ODG, RTF, TXT, CSV, ' +
      'HTML, XHTML, MD (Markdown), IDML, XML. ' +
      'Full conversion matrix: https://carbone.io/documentation/developer/http-api/generate-reports.html#output-file-type'
    ),

  convertTo: OutputFormatSchema.describe('Target output format. ' + OUTPUT_FORMAT_DESCRIPTION),

  converter: z
    .enum(CONVERTERS)
    .optional()
    .describe(CONVERTER_DESCRIPTION),

  hardRefresh: z
    .boolean()
    .optional()
    .describe(
      'If true, Carbone recomputes pagination and refreshes the table of contents at the end of the conversion. ' +
      'Carbone\'s own PDF → PDF/A-4 example uses it: { "hardRefresh": true, ' +
      '"convertTo": { "formatName": "pdf", "formatOptions": { "SelectPdfVersion": 4 } } }.'
    ),

  outputPath: z
    .string()
    .optional()
    .describe(
      'Optional local file path to save the converted document to (e.g. "/home/user/out.pdf" or "~/out.pdf"). ' +
      'When set, the file is written to disk and the tool returns the saved path + size instead of embedding ' +
      'the document inline — ideal for large files. Local (stdio) mode only; rejected in HTTP mode.'
    ),

  asAttachment: z
    .boolean()
    .optional()
    .describe(
      'If true, return the document as a downloadable file attachment (a base64 EmbeddedResource), for any format. ' +
      'Default delivery: text and png/jpg/gif/webp are returned inline; other binary outputs (PDF, Office, …) are ' +
      'saved to a temp file in stdio mode (path returned), or returned as an attachment in HTTP mode. ' +
      'Ignored when outputPath or returnLink is set.'
    ),

  returnLink: z
    .boolean()
    .optional()
    .describe(
      'If true, generate the document and return a public download URL instead of the file contents. ' +
      'The link is SHORT-LIVED and ONE-TIME — Carbone deletes the file after the first download — so it is ' +
      'meant for the end user to download once (do not fetch it programmatically). Works in stdio and HTTP. ' +
      'Mutually exclusive with outputPath and asAttachment.'
    ),

  egressAuthorization: z
    .string()
    .max(511)
    .optional()
    .describe(
      'Value for the Authorization header Carbone adds to its OUTBOUND (egress) requests during conversion — ' +
      'e.g. when a Chromium HTML→PDF conversion fetches a protected external image or stylesheet. ' +
      'For example "Bearer abc123" makes Carbone send `authorization: Bearer abc123` to those hosts. ' +
      'Only the authorization header can be customised; max 511 characters.'
    ),
};

export async function handleConvertDocument(
  args: { file: string; convertTo: z.infer<typeof convertDocumentSchema.convertTo>; converter?: (typeof CONVERTERS)[number]; hardRefresh?: boolean; outputPath?: string; asAttachment?: boolean; returnLink?: boolean; egressAuthorization?: string },
  client: CarboneClient,
  options?: CallOptions,
  fileCtx?: FileContext
) {
  try {
    const { file, outputPath, asAttachment, returnLink, ...rest } = args;
    const template = await resolveFileInput(file, {
      isCloud: client.isCloud,
      maxBytes: fileCtx?.maxFileBytes,
      allowLocalPath: fileCtx?.allowFileInput ?? false,
      allowPrivateNetwork: fileCtx?.allowPrivateNetwork ?? false,
    });
    const result = await client.convertDocument({ ...rest, template, returnLink }, options);

    return deliver(result, args.convertTo, {
      outputPath, asAttachment, allowFileOutput: fileCtx?.allowFileOutput ?? false,
      renderUrl: (id) => client.renderUrl(id),
    });
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: formatError(error) }],
    };
  }
}
