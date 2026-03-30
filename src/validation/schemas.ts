import { z } from 'zod';

/**
 * Supported output formats.
 * Always verify the full list against the official Carbone conversion matrix:
 * https://carbone.io/documentation/developer/http-api/generate-reports.html#output-file-type
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
  'idml', 'epub',
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

export const ConvertDocumentSchema = z.object({
  file: z.string().min(1, 'File content required'),
  convertTo: OutputFormatSchema,
  converter: z.enum(CONVERTERS).optional(),
});

export const RenderDocumentSchema = z.object({
  templateId: z.string().min(1).optional(),
  template:   z.string().min(1).optional(),
  data: z.record(z.string(), z.unknown()),
  convertTo: OutputFormatSchema.optional(),
  converter: z.enum(CONVERTERS).optional(),
  timezone: z.string().optional(),
  lang: z.string().optional(),
  complement: z.record(z.string(), z.unknown()).optional(),
  variableStr: z.string().optional(),
  reportName: z.string().optional(),
  enum: z.record(z.string(), z.unknown()).optional(),
  translations: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  currencySource: z.string().optional(),
  currencyTarget: z.string().optional(),
  currencyRates: z.record(z.string(), z.number()).optional(),
  hardRefresh: z.boolean().optional(),
  batchSplitBy: z.string().optional(),
  batchOutput: z.string().optional(),
  batchReportName: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  webhookHeaders: z.record(z.string(), z.string()).optional(),
}).refine(
  (d) => (d.templateId != null) !== (d.template != null),
  { message: 'Provide either templateId or template, not both', path: ['templateId'] }
);

const SampleItemSchema = z.object({
  data:         z.record(z.string(), z.unknown()),
  complement:   z.record(z.string(), z.unknown()),
  translations: z.record(z.string(), z.unknown()),
  enum:         z.record(z.string(), z.unknown()),
});

export const UploadTemplateSchema = z.object({
  template:   z.string().min(1, 'Template content required'),
  name:       z.string().min(1, 'Template name required'),
  id:         z.string().optional(),
  versioning: z.boolean().optional().default(true),
  category:   z.string().optional(),
  comment:    z.string().optional(),
  tags:       z.array(z.string()).optional(),
  sample:     z.array(SampleItemSchema).optional(),
  deployedAt: z.number().int().optional(),
  expireAt:   z.number().int().optional(),
});

export const UpdateTemplateSchema = z.object({
  templateId: z.string().min(1, 'Template ID required'),
  name:       z.string().optional(),
  comment:    z.string().optional(),
  category:   z.string().optional(),
  tags:       z.array(z.string()).optional(),
  // Unix timestamps (seconds). Pass 42000000000 to mean "deploy/expire NOW".
  deployedAt: z.number().int().optional(),
  expireAt:   z.number().int().optional(),
});

export const DeleteTemplateSchema = z.object({
  templateId: z.string().min(1, 'Template ID required'),
});

export const DownloadTemplateSchema = z.object({
  templateId: z.string().min(1, 'Template ID required'),
});
