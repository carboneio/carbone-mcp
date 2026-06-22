import { z } from 'zod';
import type { CarboneClient, CallOptions } from '../carbone/client.js';
import { OUTPUT_FORMATS, CONVERTERS } from '../validation/formats.js';
import { resolveFileInput, toToolContent } from '../utils/file.js';
import { saveOrReject, type FileContext } from './output.js';
import { formatError } from '../utils/errors.js';

export const convertDocumentToolName = 'convert_document';

export const convertDocumentDescription =
  'Convert any document to another format without storing a template. ' +
  'Supports 100+ input/output format combinations: Office documents, PDFs, images, web pages, spreadsheets, and more. ' +
  'The source file can be a local path, a URL, or a base64 string. ' +
  'Use render_document instead when you need data injection ({d.field} tags), translations, or batch generation. ' +
  'Common conversions: ' +
  'DOCX → PDF (file: "report.docx", convertTo: "pdf"), ' +
  'XLSX → PDF (file: "data.xlsx", convertTo: "pdf"), ' +
  'PPTX → PDF (file: "slides.pptx", convertTo: "pdf", converter: "O" for best fidelity), ' +
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
      'Supported input formats include: DOCX, XLSX, PPTX, ODT, ODS, ODP, ODG, HTML, XHTML, XML, IDML, ' +
      'Markdown (MD), PDF, TXT, CSV, PNG, JPG, SVG, and more. ' +
      'Full conversion matrix: https://carbone.io/documentation/developer/http-api/generate-reports.html#output-file-type'
    ),

  convertTo: z
    .union([
      z.enum(OUTPUT_FORMATS),
      z.object({
        formatName: z.enum(OUTPUT_FORMATS).describe('Target format name.'),
        formatOptions: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Advanced format options object. Examples by format: ' +
            'PDF — { "EncryptFile": true, "DocumentOpenPassword": "secret", "DocumentPermissionPassword": "owner" } password-protect; ' +
            'PDF — { "Watermarks": [{ "text": "DRAFT", "opacity": 0.2, "rotation": -45, "fontsize": 60 }] } up to 5 watermarks; ' +
            'PDF — { "SelectPdfVersion": 1 } PDF/A-1b compliance (use 2 for PDF/A-2, 3 for PDF/A-3); ' +
            'PDF — { "PageRange": "1-3,5" } export specific pages only; ' +
            'PDF — { "ConvertSlideshow": true } convert each slide to a separate PDF page; ' +
            'Images (PNG/JPG/WEBP) — { "Quality": 90 } set compression quality 0-100; ' +
            'Images — { "density": 150 } set DPI for rasterisation (default 96); ' +
            'CSV — { "fieldSeparator": ";" } custom column separator.'
          ),
      }),
    ])
    .describe(
      'Target output format. ' +
      'Documents : "pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "odg", "rtf", "epub". ' +
      'Web/text  : "html", "xhtml", "txt", "csv", "md", "xml", "idml". ' +
      'Images    : "png", "jpg", "jpeg", "webp", "svg", "tiff", "bmp", "gif". ' +
      'Archive   : "zip" (batch output). ' +
      'Simple usage: "pdf". ' +
      'Advanced usage: { "formatName": "pdf", "formatOptions": { "EncryptFile": true, "DocumentOpenPassword": "secret" } }.'
    ),

  converter: z
    .enum(CONVERTERS)
    .optional()
    .describe(
      'Converter engine. Only relevant when convertTo is "pdf" (or an image format rasterised from a document). ' +
      '"L" — LibreOffice (default): best all-round engine for DOCX, XLSX, PPTX, ODT, ODS, ODP. ' +
      '"O" — OnlyOffice: highest fidelity rendering for Microsoft Office formats (DOCX, XLSX, PPTX). ' +
      '"C" — Chromium: best for HTML, CSS, JavaScript — full browser rendering. ' +
      'If omitted, LibreOffice is used by default.'
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
      'If true, return the document as a downloadable file attachment (base64 resource) instead of inline ' +
      'text/image. Use when the user wants to download or save the file rather than read its content inline — ' +
      'especially in HTTP mode where outputPath is unavailable. Default: false (text inline, images viewable, ' +
      'other binaries as resources). Ignored when outputPath is set.'
    ),
};

export async function handleConvertDocument(
  args: { file: string; convertTo: z.infer<typeof convertDocumentSchema.convertTo>; converter?: 'L' | 'C' | 'O'; outputPath?: string; asAttachment?: boolean },
  client: CarboneClient,
  options?: CallOptions,
  fileCtx?: FileContext
) {
  try {
    const { file, outputPath, asAttachment, ...rest } = args;
    const template = await resolveFileInput(file, { isCloud: client.isCloud, maxBytes: fileCtx?.maxFileBytes });
    const result = await client.convertDocument({ ...rest, template }, options);

    if (outputPath) {
      return saveOrReject({ buffer: result.buffer, format: args.convertTo, outputPath, allowFileOutput: fileCtx?.allowFileOutput ?? false });
    }

    const content = toToolContent(result.buffer, result.filename, args.convertTo, asAttachment);
    return { content: [content] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: formatError(error) }],
    };
  }
}
