import { z } from 'zod';

const DOCS = 'https://carbone.io/documentation/developer/http-api/generate-reports.html';

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
 * Formats Carbone reads as a template or a conversion source. Rendering and conversion share one endpoint and
 * one validation, so the list is the same for both. Checked live: a legacy binary DOC is rejected with 415
 * "Template format not supported, it must be an XML-based or Text-based document" (w118), although the OpenAPI
 * v5.15.0 `template` description still lists DOC, XLS and PPT as inputs.
 */
export const INPUT_FORMATS = [
  'DOCX', 'XLSX', 'PPTX', 'ODT', 'ODS', 'ODP', 'ODG', 'HTML', 'XHTML', 'XML', 'SVG', 'IDML', 'MD', 'TXT', 'CSV', 'RTF', 'PDF',
] as const;

/** Input-format guidance shared by the file/template parameters and get_capabilities. */
export const INPUT_FORMATS_DESCRIPTION =
  'Supported input formats: ' + INPUT_FORMATS.join(', ') + '. ' +
  'Carbone reads XML-based and text-based documents (plus PDF): the legacy binary Office formats DOC, XLS and PPT ' +
  'are rejected as input, although they are valid outputs. Re-save such a file as DOCX, XLSX or PPTX first.';

/** Converter guidance shared by render_document and convert_document (OpenAPI `Converter`). */
export const CONVERTER_DESCRIPTION =
  'Converter engine, used whenever the format changes (not only for PDF). If omitted, "L" is used. ' +
  '"L" LibreOffice: DOCX, XLSX, PPTX, ODT, ODS, ODP, ODG, MD, PDF; the only converter supporting all PDF options. ' +
  '"I" Carbone ICE: DOCX and ODT (beta) to PDF; the fastest, recommended over "O" for DOCX from v5.15.0 ' +
  '(limitations: ' + DOCS + '#converters-carbone-ice-limitations). ' +
  '"O" OnlyOffice: DOCX, XLSX, PPTX to PDF. ' +
  '"C" Chromium: HTML to PDF, JPG, PNG, WEBP with full CSS/JS; 100 MB max. ' +
  '"O", "C" and "I" support only the Security (passwords, permissions) and Watermark PDF options. ' +
  'Docs: ' + DOCS + '#converters';

/** convertTo guidance shared by both tools. */
export const OUTPUT_FORMAT_DESCRIPTION =
  'Valid outputs depend on the input format (e.g. HTML converts to pdf, docx or png, but not xlsx); ' +
  'see the conversion matrix: ' + DOCS + '#output-file-type. ' +
  '"doc", "xls" and "ppt" are output-only: Carbone writes them but cannot read them back. ' +
  'Simple usage: "pdf". With options: { "formatName": "pdf", "formatOptions": { ... } }.';

/** Target format: either a simple string or an object with advanced options. */
export const OutputFormatSchema = z.union([
  z.enum(OUTPUT_FORMATS),
  z.object({
    formatName: z.enum(OUTPUT_FORMATS).describe('Target format name.'),
    formatOptions: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        // Every key below exists in the OpenAPI ConvertToOption formatOptions.
        'Format-specific options. Examples: ' +
        'PDF password: { "EncryptFile": true, "DocumentOpenPassword": "s3cr3t" }; ' +
        'PDF permissions: { "RestrictPermissions": true, "PermissionPassword": "owner" }; ' +
        'PDF watermarks (max 4): { "Watermarks": [{ "text": "DRAFT", "size": 60, "opacity": 0.2, "rotation": -45 }] }; ' +
        'PDF/A (L only): { "SelectPdfVersion": 2 } (2 = PDF/A-2b, 3 = PDF/A-3b, 4 = PDF/A-4); ' +
        'page selection (L only): { "PageRange": "1-5" }; ' +
        'accessibility (L only): { "UseTaggedPDF": true, "PDFUACompliance": true }; ' +
        'JPG/PNG: { "PixelWidth": 1200, "PixelHeight": 630 }, JPG quality: { "Quality": 80 } (1-100); ' +
        'CSV: { "fieldSeparator": ";" }. ' +
        'All options: ' + DOCS + '#pdf-options'
      ),
  }),
]);
