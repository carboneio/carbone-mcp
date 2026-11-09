import { z } from 'zod';

/**
 * Supported `convertTo` format names: a closed list synced with the Carbone OpenAPI (v5.15.0) RenderSuccess
 * content types and ConvertToOption examples, plus `jpeg` (the API accepts it like `jpg`). The LaTeX, BibTeX
 * and TeX content types are left out: the spec does not give their format names.
 * Each format was checked live from its natural input: the spec's xlsb, pps, pbm, pgm and ppm content types
 * are not producible on Carbone Cloud (500 w101), so they are left out too.
 * ZIP is not a format: batch archives come from `batchOutput`.
 * Valid outputs depend on the input format, see the conversion matrix:
 * https://carbone.io/documentation/developer/http-api/generate-reports.html#output-file-type
 *
 * These constants are shared by the tool input schemas (src/tools/*) and the
 * validation schemas (src/validation/schemas.ts). They live in their own module
 * so both can import them without creating a circular dependency.
 */
export const OUTPUT_FORMATS = [
  // Text documents. doc, xls and ppt are OUTPUT-ONLY: Carbone writes the legacy binary Office formats
  // but cannot read them back (415 w118 as input), see INPUT_FORMATS_DESCRIPTION.
  'pdf', 'docx', 'doc', 'odt', 'ott', 'rtf', 'epub',
  // Spreadsheets
  'xlsx', 'xls', 'ods', 'ots', 'csv', 'dbf', 'dif',
  // Presentations / drawings
  'pptx', 'ppt', 'odp', 'otp', 'odg',
  // Web / text
  'html', 'xhtml', 'txt', 'md', 'xml', 'idml',
  // Images
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'tiff', 'bmp', 'svg', 'emf', 'wmf', 'eps',
] as const;

export const CONVERTERS = ['L', 'O', 'C', 'I'] as const;

/**
 * An integer, checked as a safe integer, whose JSON Schema states no ±2^53 bounds: zod adds them, and they are only
 * noise in what the model reads. Pass `min` to keep a real lower bound.
 */
export function integer(min?: number) {
  const schema = z.number().int();
  return min === undefined
    ? schema.meta({ minimum: undefined, maximum: undefined })
    : schema.min(min).meta({ maximum: undefined });
}

/**
 * Formats Carbone reads as a template or a conversion source. Rendering and conversion share one endpoint and
 * one validation, so the list is the same for both. Checked live: a legacy binary DOC is rejected with 415
 * "Template format not supported, it must be an XML-based or Text-based document" (w118), although the OpenAPI
 * v5.15.0 `template` description still lists DOC, XLS and PPT as inputs.
 */
export const INPUT_FORMATS = [
  'DOCX', 'XLSX', 'PPTX', 'ODT', 'ODS', 'ODP', 'ODG', 'HTML', 'XHTML', 'XML', 'SVG', 'IDML', 'MD', 'TXT', 'CSV', 'RTF', 'PDF',
] as const;

/**
 * Input-format guidance shared by the file/template parameters. The tool texts below are kept short: every tool
 * description is sent to the model on each conversation, and get_capabilities holds the details (named by the
 * instructions only: a parameter description names no tool, as it is listed even when that tool is disabled).
 */
export const INPUT_FORMATS_DESCRIPTION =
  'Formats: ' + INPUT_FORMATS.join(', ') + '; not the legacy binary DOC, XLS or PPT (re-save them as DOCX, XLSX, PPTX).';

/** Converter guidance shared by render_document and convert_document. Names no tool (MCP_DISABLED_TOOLS): their descriptions point to get_capabilities. */
export const CONVERTER_DESCRIPTION =
  'Converter, used whenever the format changes. "L" LibreOffice (default): every format, and the only one with ' +
  'PDF/A, page ranges and accessibility. "I" Carbone ICE: DOCX and ODT to PDF, the fastest (keep "L" for SmartArt, ' +
  'complex charts, comments, form fields, equations). "O" OnlyOffice: DOCX, XLSX, PPTX to PDF. "C" Chromium: HTML ' +
  'and SVG to PDF, PNG, JPG, WEBP.';

/** convertTo guidance shared by both tools. */
export const OUTPUT_FORMAT_DESCRIPTION =
  'Valid outputs depend on the input format (HTML converts to pdf or png, not xlsx; doc, xls and ppt are output ' +
  'only). With options: { "formatName": "pdf", "formatOptions": { ... } }.';

/** Target format: either a simple string or an object with advanced options. */
export const OutputFormatSchema = z.union([
  z.enum(OUTPUT_FORMATS),
  z.object({
    // Checked against OUTPUT_FORMATS without listing them a second time in the schema the model reads.
    formatName: z.string().refine((name) => (OUTPUT_FORMATS as readonly string[]).includes(name), {
      message: `Unknown format. Use one of: ${OUTPUT_FORMATS.join(', ')}.`,
    }).describe('Same values as the string form.'),
    formatOptions: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        // Every key below exists in the Carbone documentation; get_capabilities lists them all. Names no tool: the
        // descriptions of render_document and convert_document point to get_capabilities.
        'PDF: { "EncryptFile": true, "DocumentOpenPassword": "s3cr3t" }, { "Watermarks": [{ "text": "DRAFT", ' +
        '"opacity": 0.2 }] }, PDF/A { "SelectPdfVersion": 2 } or { "PageRange": "1-5" } (converter "L"). ' +
        'Images: { "PixelWidth": 1200, "Scale": 2, "Quality": 80 }. CSV: { "fieldSeparator": ";" }.'
      ),
  }),
]);
