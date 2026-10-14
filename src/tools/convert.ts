import { z } from 'zod';
import type { CarboneClient, CallOptions } from '../carbone/client.js';
import {
  CONVERTERS, CONVERTER_DESCRIPTION, INPUT_FORMATS_DESCRIPTION, OUTPUT_FORMAT_DESCRIPTION, OutputFormatSchema,
} from '../validation/formats.js';
import { resolveFileInput } from '../utils/file.js';
import { deliver, withReportName, type FileContext } from './output.js';
import { formatError } from '../utils/errors.js';
import { type IoModes, STDIO_IO, inputForms, inputFormsShort, outputPathDescription } from './inputForms.js';

export const convertDocumentToolName = 'convert_document';

export function convertDocumentDescriptionFor(io: IoModes): string {
  return 'Convert a document to another format without storing a template. ' +
    'Pure conversion: no data is sent, so Carbone tags such as {d.name} are kept as written; this is also how you ' +
    'proof a template in another format (DOCX template → PDF, or DOCX → ODT while it stays a template). ' +
    'The source file can be ' + inputFormsShort(io) + '. ' +
    'Use render_document instead when you need data injection ({d.field} tags resolved), translations, or batch generation. ' +
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
}

/** Default (stdio) wording. */
export const convertDocumentDescription = convertDocumentDescriptionFor(STDIO_IO);

export function convertDocumentSchemaFor(io: IoModes) {
  return {
    file: z
      .string()
      .min(1)
      .describe(
        'The document to convert. ' + inputForms(io) + INPUT_FORMATS_DESCRIPTION + ' ' +
        'Full conversion matrix: https://carbone.io/documentation/developer/http-api/generate-reports.html#output-file-type'
      ),

    convertTo: OutputFormatSchema.describe('Target output format. ' + OUTPUT_FORMAT_DESCRIPTION),

    converter: z
      .enum(CONVERTERS)
      .optional()
      .describe(CONVERTER_DESCRIPTION),

    reportName: z
      .string()
      .optional()
      .describe(
        'Name of the delivered file, WITHOUT extension (e.g. "contract", "2026-invoice"). The document is delivered as ' +
        '"<reportName>.<ext>", with the extension of convertTo, used as ' +
        (io.allowFileOutput ? 'the attachment name and the default saved file name. ' : 'the attachment name. ') +
        'This server applies it: Carbone ignores reportName on a pure conversion, which would deliver "report.<ext>". ' +
        'Used literally: Carbone tags such as {d.id} are not resolved here. ' +
        'Ignored with returnLink (a download URL, not a named file)' +
        (io.allowFileOutput ? ' and with outputPath (which sets the path itself).' : '.')
      ),

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
      .describe(outputPathDescription('converted document', io)),

    asAttachment: z
      .boolean()
      .optional()
      .describe(
        'If true, return the document as a downloadable file attachment (a base64 EmbeddedResource), for any format. ' +
        'Default delivery: text and png/jpg/gif/webp are returned inline; other binary outputs (PDF, Office, …) are ' +
        (io.allowFileOutput
          ? 'saved to a temp file (path returned). '
          : 'returned as an attachment. ') +
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
}

/** Default (stdio) wording — also the shape the validation schemas derive from. */
export const convertDocumentSchema = convertDocumentSchemaFor(STDIO_IO);

export async function handleConvertDocument(
  args: { file: string; convertTo: z.infer<typeof convertDocumentSchema.convertTo>; converter?: (typeof CONVERTERS)[number]; reportName?: string; hardRefresh?: boolean; outputPath?: string; asAttachment?: boolean; returnLink?: boolean; egressAuthorization?: string },
  client: CarboneClient,
  options?: CallOptions,
  fileCtx?: FileContext
) {
  try {
    // reportName is not sent: Carbone ignores it without templating, so it is applied to the delivered file below.
    const { file, outputPath, asAttachment, returnLink, reportName, ...rest } = args;
    const template = await resolveFileInput(file, {
      isCloud: client.isCloud,
      maxBytes: fileCtx?.maxFileBytes,
      allowLocalPath: fileCtx?.allowFileInput ?? false,
      allowPrivateNetwork: fileCtx?.allowPrivateNetwork ?? false,
    });
    const result = await client.convertDocument({ ...rest, template, returnLink }, options);

    return deliver(withReportName(result, reportName, args.convertTo), args.convertTo, {
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
