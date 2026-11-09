import { z } from 'zod';
import type { CarboneClient, CallOptions } from '../carbone/client.js';
import {
  CONVERTERS, CONVERTER_DESCRIPTION, INPUT_FORMATS_DESCRIPTION, OUTPUT_FORMAT_DESCRIPTION, OutputFormatSchema,
} from '../validation/formats.js';
import { resolveFileInput } from '../utils/file.js';
import { deliver, wantsLink, withReportName, type FileContext } from './output.js';
import { formatError } from '../utils/errors.js';
import {
  type IoModes, STDIO_IO, asAttachmentDescription, defaultDelivery, exampleFile, fieldIf, inputForms, outputPathDescription,
  returnLinkDescription,
} from './inputForms.js';
import { type ChatFile, acceptsChatAttachments, chatFileSchema, pickFile } from './attachments.js';
import { FAIL_ON_CONDITIONS, checkedOnce } from './render.js';

export const convertDocumentToolName = 'convert_document';

export function convertDocumentDescriptionFor(io: IoModes): string {
  return 'Convert a file to another format, e.g. DOCX, XLSX, PPTX, HTML or Markdown to PDF, or any document to PNG. ' +
    'No data is merged: Carbone tags such as {d.name} stay as written. To fill them, use render_document. ' +
    'Example: { "file": "' + exampleFile('report.docx', io) + '", "convertTo": "pdf" }. ' +
    'To check a layout, convert to png: the image is returned inline (for HTML or SVG, converter "C" with ' +
    'formatOptions { "Scale": 2 }). Converters and format options: get_capabilities. ' + defaultDelivery(io);
}

/** Default (stdio) wording. */
export const convertDocumentDescription = convertDocumentDescriptionFor(STDIO_IO);

export function convertDocumentSchemaFor(io: IoModes) {
  const file = z.string().min(1);
  return {
    // With a chat attachment on offer, file is checked at runtime instead: it is required unless attachedFile is set.
    file: (acceptsChatAttachments(io) ? file.optional() : file)
      .describe('The file to convert. ' + inputForms(io) + INPUT_FORMATS_DESCRIPTION),
    ...fieldIf(acceptsChatAttachments(io), 'attachedFile', chatFileSchema('file')),

    convertTo: OutputFormatSchema.describe('Output format, e.g. "pdf". ' + OUTPUT_FORMAT_DESCRIPTION),

    converter: z
      .enum(CONVERTERS)
      .optional()
      .describe(CONVERTER_DESCRIPTION),

    reportName: z
      .string()
      .optional()
      .describe('File name without extension, taken literally (no tags), e.g. "contract".'),

    hardRefresh: z
      .boolean()
      .optional()
      .describe(
        'If true, run the converter even for the same format, and recompute pagination. Set automatically for ' +
        'PDF to PDF with formatOptions (password, watermark, PDF/A), which otherwise come back unchanged.'
      ),

    failOn: checkedOnce(z.array(z.enum(FAIL_ON_CONDITIONS)))
      .optional()
      .describe('["IMAGE_URL_ERROR"] with converter "C": fail when an image of the HTML or SVG cannot be downloaded.'),

    outputPath: z
      .string()
      .optional()
      .describe(outputPathDescription('converted document')),

    asAttachment: z
      .boolean()
      .optional()
      .describe(asAttachmentDescription(io)),

    returnLink: z
      .boolean()
      .optional()
      .describe(returnLinkDescription(io)),

    egressAuthorization: z
      .string()
      .max(511)
      .optional()
      .describe('Authorization header value Carbone sends when it fetches images or styles of the file, e.g. "Bearer abc".'),
  };
}

/** Default (stdio) wording, also the shape the validation schemas derive from. */
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
  args: { file?: string; attachedFile?: ChatFile; convertTo: z.infer<typeof convertDocumentSchema.convertTo>; converter?: (typeof CONVERTERS)[number]; reportName?: string; hardRefresh?: boolean; failOn?: (typeof FAIL_ON_CONDITIONS)[number][]; outputPath?: string; asAttachment?: boolean; returnLink?: boolean; egressAuthorization?: string },
  client: CarboneClient,
  options?: CallOptions,
  fileCtx?: FileContext
) {
  const { source: file, error } = pickFile(args.file, args.attachedFile, ['file', 'attachedFile']);
  if (error || file == null) {
    return { isError: true, content: [{ type: 'text' as const, text: error ?? 'Provide the document to convert in file.' }] };
  }

  try {
    // Authenticate first: a caller without credentials must not be able to trigger any URL download.
    client.assertCanAuthenticate(options);

    // reportName is not sent: Carbone resolves it during templating, which a conversion skips, so it is applied to
    // the delivered file below.
    const { file: _file, attachedFile: _attachedFile, outputPath, asAttachment, returnLink, reportName, ...rest } = args;
    const template = await resolveFileInput(file, {
      isCloud: client.isCloud,
      maxBytes: fileCtx?.maxFileBytes,
      allowLocalPath: fileCtx?.allowFileInput ?? false,
      allowPrivateNetwork: fileCtx?.allowPrivateNetwork ?? false,
    });
    const hardRefresh = rest.hardRefresh ?? (needsPdfHardRefresh(template, args.convertTo) ? true : undefined);
    const link = wantsLink({ returnLink, asAttachment, outputPath, convertTo: args.convertTo, allowFileOutput: fileCtx?.allowFileOutput ?? false });
    const result = await client.convertDocument({ ...rest, hardRefresh, template, returnLink: link }, options);

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
