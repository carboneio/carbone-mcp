import { z } from 'zod';

/**
 * Supported output formats.
 * Always verify the full list against the official Carbone conversion matrix:
 * https://carbone.io/documentation/developer/http-api/generate-reports.html#output-file-type
 *
 * These constants are shared by the tool input schemas (src/tools/*) and the
 * validation schemas (src/validation/schemas.ts). They live in their own module
 * so both can import them without creating a circular dependency.
 */
export const OUTPUT_FORMATS = [
  // Documents
  'pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'odg',
  // Web / text
  'html', 'xhtml', 'txt', 'csv', 'md', 'xml', 'rtf',
  // Images
  'png', 'jpg', 'jpeg', 'webp', 'svg', 'tiff', 'bmp', 'gif',
  // Archives
  'zip',
  // Other
  'idml', 'epub', 'cdr',
] as const;

export const CONVERTERS = ['L', 'C', 'O'] as const;

/** Target format: either a simple string or an object with advanced options. */
export const OutputFormatSchema = z.union([
  z.enum(OUTPUT_FORMATS),
  z.object({
    formatName: z.enum(OUTPUT_FORMATS),
    formatOptions: z.record(z.string(), z.unknown()).optional(),
  }),
]);
