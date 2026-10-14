import { z } from 'zod';
import type { CarboneClient, CallOptions } from '../carbone/client.js';
import {
  CONVERTERS, CONVERTER_DESCRIPTION, INPUT_FORMATS_DESCRIPTION, OUTPUT_FORMAT_DESCRIPTION, OutputFormatSchema,
} from '../validation/formats.js';
import { resolveFileInput } from '../utils/file.js';
import { deliver, withReportName, type FileContext } from './output.js';
import { formatError } from '../utils/errors.js';
import { type IoModes, STDIO_IO, exampleFile, inputForms, inputFormsShort, outputPathDescription } from './inputForms.js';

export const convertDocumentToolName = 'convert_document';

export function convertDocumentDescriptionFor(io: IoModes): string {
  return 'Convert a document to another format without storing a template. ' +
    'Pure conversion: no data is sent, so Carbone tags such as {d.name} are kept as written; this is also how you ' +
    'proof a template in another format (DOCX template → PDF, or DOCX → ODT while it stays a template). ' +
    'The source file can be ' + inputFormsShort(io) + '. ' +
    'Use render_document instead when you need data injection ({d.field} tags resolved), translations, or batch generation. ' +
    'Example: { "file": "' + exampleFile('report.docx', io) + '", "convertTo": "pdf" }' +
    (io.allowLocalPath ? ' (a bare file name such as "report.docx" is not a path). ' : '. ') +
    'Common conversions: DOCX → PDF (add converter: "I" for the fastest conversion), XLSX → PDF, PPTX → PDF, ' +
    'HTML → PDF (converter: "C" for full CSS/JS rendering), DOCX → HTML, XLSX → CSV, PDF → PNG, ' +
    'PPTX → PNG (first slide as image), MD → PDF.';
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
        'This server names the file itself: a conversion has no templating pass, which is where Carbone resolves reportName. ' +
        'Used literally: Carbone tags such as {d.id} are not resolved here. ' +
        'Ignored with returnLink (a download URL, not a named file)' +
        (io.allowFileOutput ? ' and with outputPath (which sets the path itself).' : '.')
      ),

    hardRefresh: z
      .boolean()
      .optional()
      .describe(
        'If true, Carbone runs the converter even when the output format equals the input format, and recomputes ' +
        'pagination and the table of contents at the end of the conversion. Needed for PDF → PDF: without it Carbone ' +
        'returns the PDF unchanged and formatOptions (password, permissions, watermarks, PDF/A, …) are NOT applied. ' +
        'This server sets it automatically when the input is a PDF, convertTo is "pdf" and formatOptions are given; ' +
        'pass false to opt out. Example (PDF → PDF/A-4): { "hardRefresh": true, ' +
        '"convertTo": { "formatName": "pdf", "formatOptions": { "SelectPdfVersion": 4 } } }.'
      ),

    outputPath: z
      .string()
      .optional()
      .describe(outputPathDescription('converted document', io, { returnLink: true })),

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

/** "%PDF-" is the PDF header; its base64 form is "JVBERi0". The resolved input is always base64. */
function isPdfBase64(base64: string): boolean {
  return Buffer.from(base64.slice(0, 8), 'base64').subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * PDF → PDF only applies formatOptions when hardRefresh is set: without it Carbone hands the PDF back
 * unchanged, so a password, permissions, watermarks or PDF/A are silently dropped (measured live:
 * EncryptFile without hardRefresh returns an unencrypted PDF). It is turned on only when formatOptions are
 * present: a plain "pdf" target has nothing to apply, and the pass-through returns the file untouched,
 * whereas forcing the converter would only cost time and re-render the document.
 */
export function needsPdfHardRefresh(templateBase64: string, convertTo: z.infer<typeof convertDocumentSchema.convertTo>): boolean {
  if (typeof convertTo !== 'object' || convertTo.formatName !== 'pdf') return false;
  if (!convertTo.formatOptions || Object.keys(convertTo.formatOptions).length === 0) return false;
  return isPdfBase64(templateBase64);
}

export async function handleConvertDocument(
  args: { file: string; convertTo: z.infer<typeof convertDocumentSchema.convertTo>; converter?: (typeof CONVERTERS)[number]; reportName?: string; hardRefresh?: boolean; outputPath?: string; asAttachment?: boolean; returnLink?: boolean; egressAuthorization?: string },
  client: CarboneClient,
  options?: CallOptions,
  fileCtx?: FileContext
) {
  try {
    // Authenticate first: a caller without credentials must not be able to trigger any URL download.
    client.assertCanAuthenticate(options);

    // reportName is not sent: Carbone resolves it during templating, which a conversion skips, so it is applied to
    // the delivered file below.
    const { file, outputPath, asAttachment, returnLink, reportName, ...rest } = args;
    const template = await resolveFileInput(file, {
      isCloud: client.isCloud,
      maxBytes: fileCtx?.maxFileBytes,
      allowLocalPath: fileCtx?.allowFileInput ?? false,
      allowPrivateNetwork: fileCtx?.allowPrivateNetwork ?? false,
    });
    const hardRefresh = rest.hardRefresh ?? (needsPdfHardRefresh(template, args.convertTo) ? true : undefined);
    const result = await client.convertDocument({ ...rest, hardRefresh, template, returnLink }, options);

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
