import { z } from 'zod';
import { convertDocumentSchema } from '../tools/convert.js';
import { renderDocumentSchema } from '../tools/render.js';
import {
  uploadTemplateSchema,
  updateTemplateMetadataSchema,
  deleteTemplateSchema,
  downloadTemplateSchema,
} from '../tools/templates.js';

// Shared format/converter constants. Re-exported here for backward compatibility;
// they are defined in formats.ts so the tool modules can import them without a cycle.
export { OUTPUT_FORMATS, CONVERTERS, OutputFormatSchema } from './formats.js';

/**
 * Validation schemas derived from the *exact* raw shapes registered with the MCP
 * server in src/tools/*. Deriving them — rather than re-declaring — guarantees a
 * single source of truth: the validation schema can never drift from what the
 * tool actually accepts.
 */
export const ConvertDocumentSchema = z.object(convertDocumentSchema);

export const RenderDocumentSchema = z.object(renderDocumentSchema).refine(
  (d) => (d.templateId != null) !== (d.template != null),
  { message: 'Provide either templateId or template, not both', path: ['templateId'] }
);

export const UploadTemplateSchema = z.object(uploadTemplateSchema);

export const UpdateTemplateSchema = z.object(updateTemplateMetadataSchema);

export const DeleteTemplateSchema = z.object(deleteTemplateSchema);

export const DownloadTemplateSchema = z.object(downloadTemplateSchema);
