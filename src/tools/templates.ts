import { z } from 'zod';
import type { CarboneClient, CallOptions } from '../carbone/client.js';
import type { UploadTemplateResult } from '../carbone/types.js';
import { resolveFileInput, toToolContent } from '../utils/file.js';
import { formatError } from '../utils/errors.js';

// ─── list_templates ──────────────────────────────────────────────────────────

export const listTemplatesToolName = 'list_templates';

export const listTemplatesDescription =
  'List stored Carbone templates with filtering, search, and pagination. ' +
  'Filter by Template ID, Version ID, category, or upload origin. ' +
  'Use includeVersions to see the full version history of each template. ' +
  'Supports cursor-based pagination for large collections. ' +
  'Note: filtering by tags is not supported by the Carbone API — use list_tags to discover tags, then filter results manually.';

export const listTemplatesSchema = {
  id: z
    .string()
    .optional()
    .describe('Filter by Template ID (64-bit format). Cannot be a Version ID.'),
  versionId: z
    .string()
    .optional()
    .describe('Filter by Version ID (SHA-256 format).'),
  category: z
    .string()
    .optional()
    .describe('Filter by category (e.g. "invoices", "legal").'),
  origin: z
    .number()
    .int()
    .optional()
    .describe('Filter by upload origin. 0 = uploaded via API, 1 = uploaded via Carbone Studio.'),
  includeVersions: z
    .boolean()
    .optional()
    .describe('If true, returns all versions for each template. Default: false (only deployed version).'),
  search: z
    .string()
    .optional()
    .describe('Fuzzy search in template names, or exact match on Template ID / Version ID.'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum number of results to return (default: 100).'),
  cursor: z
    .string()
    .optional()
    .describe('Pagination cursor from the previous response nextCursor field. Use to fetch the next page.'),
};

export async function handleListTemplates(
  args: {
    id?: string;
    versionId?: string;
    category?: string;
    origin?: number;
    includeVersions?: boolean;
    search?: string;
    limit?: number;
    cursor?: string;
  },
  client: CarboneClient,
  options?: CallOptions
) {
  try {
    const templates = await client.listTemplates(args, options);

    if (templates.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No templates found.' }] };
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(templates, null, 2) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: formatError(error) }],
    };
  }
}

// ─── upload_template ─────────────────────────────────────────────────────────

export const uploadTemplateToolName = 'upload_template';

export const uploadTemplateDescription =
  'Upload and store a reusable Carbone template. ' +
  'Once uploaded, use render_document with the returned Template ID to generate documents from it. ' +
  'Supports versioning: multiple versions can live under a single stable Template ID, ' +
  'with deployedAt controlling which version is active. ' +
  'Accepted formats: DOCX, XLSX, PPTX, ODT, ODS, ODP, ODG, HTML, XHTML, IDML, XML, Markdown, PDF, and more.';

export const uploadTemplateSchema = {
  template: z
    .string()
    .min(1)
    .describe(
      'The template file. Accepts a local file path (e.g. /home/user/invoice.docx), ' +
      'a URL (https://example.com/template.docx), or a base64-encoded string. ' +
      'Supported formats: DOCX, XLSX, PPTX, ODT, ODS, ODP, ODG, HTML, XHTML, IDML, XML, Markdown (MD), PDF, and more. ' +
      'Full list: https://carbone.io/documentation/developer/http-api/generate-reports.html#output-file-type'
    ),
  name: z
    .string()
    .min(1)
    .describe('Display name for the template (e.g. "Invoice Template", "NDA Contract").'),
  id: z
    .string()
    .optional()
    .describe(
      'Existing Template ID (64-bit format) to add this upload to its version history. ' +
      'If omitted, a new Template ID is generated. ' +
      'Providing a Version ID (SHA-256) is not allowed and will cause an error.'
    ),
  versioning: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Enable template versioning (default: true). ' +
      'When true, a stable Template ID is generated and multiple versions can be managed under it. ' +
      'When false, behaves as legacy mode and returns only a templateId (SHA-256 hash).'
    ),
  category: z
    .string()
    .optional()
    .describe('Group templates into folders/categories (e.g. "invoices", "legal", "hr").'),
  comment: z
    .string()
    .optional()
    .describe('Free-text comment to describe the template version or its purpose.'),
  tags: z
    .array(z.string())
    .optional()
    .describe('Tags for searchability and filtering (e.g. ["sales", "billing", "v2"]).'),
  sample: z
    .array(
      z.object({
        data:         z.record(z.string(), z.unknown()).describe('JSON dataset for {d.} tags.'),
        complement:   z.record(z.string(), z.unknown()).describe('Extra data for {c.} tags.'),
        translations: z.record(z.string(), z.unknown()).describe('Localization map for {t()} tags.'),
        enum:         z.record(z.string(), z.unknown()).describe('Enumerations for :convEnum() formatter.'),
      })
    )
    .optional()
    .describe(
      'Sample input data attached to the template for testing in Carbone Studio. ' +
      'Each item must include data, complement, translations, and enum objects.'
    ),
  deployedAt: z
    .number()
    .int()
    .optional()
    .describe(
      'UTC Unix timestamp (seconds) to set as the deployment time for this version. ' +
      'Carbone uses the version with the most recent deployedAt when rendering via Template ID. ' +
      'Use 42000000000 to deploy immediately (special "NOW" sentinel value).'
    ),
  expireAt: z
    .number()
    .int()
    .optional()
    .describe(
      'UTC Unix timestamp (seconds) at which this template will be automatically deleted. ' +
      'Use 42000000000 to delete immediately (special "NOW" sentinel value).'
    ),
};

export async function handleUploadTemplate(
  args: {
    template:    string;
    name:        string;
    id?:         string;
    versioning?: boolean;
    category?:   string;
    comment?:    string;
    tags?:       string[];
    sample?:     Array<{ data: Record<string, unknown>; complement: Record<string, unknown>; translations: Record<string, unknown>; enum: Record<string, unknown> }>;
    deployedAt?: number;
    expireAt?:   number;
  },
  client: CarboneClient,
  options?: CallOptions
) {
  try {
    const template = await resolveFileInput(args.template);
    const result: UploadTemplateResult = await client.uploadTemplate({ ...args, template }, options);

    // The API returns different shapes depending on whether versioning is enabled
    const lines: string[] = ['Template uploaded successfully!', ''];
    if ('id' in result) {
      lines.push(`Template ID : ${result.id}`);
      lines.push(`Version ID  : ${result.versionId}`);
      if (result.type) lines.push(`Type        : ${result.type}`);
      if (result.size) lines.push(`Size        : ${result.size} bytes`);
    } else {
      // Legacy / versioning disabled response
      lines.push(`Template ID : ${result.templateId}`);
    }
    lines.push(`Name        : ${args.name}`);

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: formatError(error) }],
    };
  }
}

// ─── update_template_metadata ────────────────────────────────────────────────

export const updateTemplateMetadataToolName = 'update_template_metadata';

export const updateTemplateMetadataDescription =
  'Update the metadata of a stored template: name, comment, category, tags, deployment timestamp, or expiration. ' +
  'Use deployedAt to activate a specific version for rendering. ' +
  'Use expireAt to schedule or trigger immediate deletion.';

export const updateTemplateMetadataSchema = {
  templateId: z
    .string()
    .min(1)
    .describe(
      'Template ID (64-bit) or Version ID (SHA-256) to update. ' +
      'Using a Template ID updates the metadata shared by all versions. ' +
      'Using a Version ID updates only that specific version.'
    ),
  name: z.string().optional().describe('New display name.'),
  comment: z.string().optional().describe('New free-text comment.'),
  category: z.string().optional().describe('New category.'),
  tags: z.array(z.string()).optional().describe('New list of tags — replaces existing tags entirely.'),
  deployedAt: z
    .number()
    .int()
    .optional()
    .describe(
      'Unix timestamp (seconds) to set as the deployment time for this version. ' +
      'Carbone picks the version with the most recent deployedAt when rendering. ' +
      'Use 42000000000 to deploy immediately (special "NOW" value).'
    ),
  expireAt: z
    .number()
    .int()
    .optional()
    .describe(
      'Unix timestamp (seconds) at which this template will be automatically deleted. ' +
      'Use 42000000000 to delete immediately.'
    ),
};

export async function handleUpdateTemplateMetadata(
  args: {
    templateId:  string;
    name?:       string;
    comment?:    string;
    category?:   string;
    tags?:       string[];
    deployedAt?: number;
    expireAt?:   number;
  },
  client: CarboneClient,
  options?: CallOptions
) {
  try {
    await client.updateTemplate(args, options);

    return {
      content: [{ type: 'text' as const, text: 'Template metadata updated successfully.' }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: formatError(error) }],
    };
  }
}

// ─── delete_template ─────────────────────────────────────────────────────────

export const deleteTemplateToolName = 'delete_template';

export const deleteTemplateDescription =
  'Delete a stored Carbone template. ' +
  'This is a soft delete: the template is marked for garbage collection and removed after a delay (default 24 hours). ' +
  'You can delete by Template ID (removes all versions) or by Version ID (removes only that specific version). ' +
  'For immediate or scheduled deletion, use update_template_metadata with expireAt = 42000000000 (NOW) or a future Unix timestamp.';

export const deleteTemplateSchema = {
  templateId: z
    .string()
    .min(1)
    .describe(
      'Template ID (64-bit) or Version ID (SHA-256) to delete. ' +
      'Template ID — deletes the template record and all its versions. ' +
      'Version ID — deletes only that specific version, leaving other versions intact. ' +
      'Both formats are returned by upload_template and list_templates.'
    ),
};

export async function handleDeleteTemplate(
  args: { templateId: string },
  client: CarboneClient,
  options?: CallOptions
) {
  try {
    await client.deleteTemplate(args.templateId, options);
    return {
      content: [{ type: 'text' as const, text: 'Template deleted successfully.' }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: formatError(error) }],
    };
  }
}

// ─── list_categories ─────────────────────────────────────────────────────────

export const listCategoriesToolName = 'list_categories';

export const listCategoriesDescription =
  'List all template categories currently in use in your Carbone account. ' +
  'Categories act like folders for organising templates (e.g. "invoices", "legal", "hr"). ' +
  'Use the returned names as the category filter in list_templates or upload_template.';

export const listCategoriesSchema = {};

export async function handleListCategories(
  _args: Record<string, never>,
  client: CarboneClient,
  options?: CallOptions
) {
  try {
    const categories = await client.getCategories(options);

    if (categories.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No categories found.' }] };
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(categories, null, 2) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: formatError(error) }],
    };
  }
}

// ─── list_tags ────────────────────────────────────────────────────────────────

export const listTagsToolName = 'list_tags';

export const listTagsDescription =
  'List all tags currently used across templates in your Carbone account. ' +
  'Tags are free-form labels attached to templates (e.g. "sales", "billing", "v2"). ' +
  'Note: the Carbone API does not support filtering list_templates by tag — ' +
  'use this tool to discover available tags, then call list_templates and filter the results manually.';

export const listTagsSchema = {};

export async function handleListTags(
  _args: Record<string, never>,
  client: CarboneClient,
  options?: CallOptions
) {
  try {
    const tags = await client.getTags(options);

    if (tags.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No tags found.' }] };
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(tags, null, 2) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: formatError(error) }],
    };
  }
}

// ─── download_template ───────────────────────────────────────────────────────

export const downloadTemplateToolName = 'download_template';

export const downloadTemplateDescription =
  'Download the original source file of a stored Carbone template (e.g. the DOCX, XLSX, PPTX, or HTML file that was uploaded). ' +
  'Use this to inspect, edit, or back up a template. ' +
  'Pass a Template ID to download the currently deployed version, or a Version ID to download a specific version.';

export const downloadTemplateSchema = {
  templateId: z
    .string()
    .min(1)
    .describe(
      'Template ID (64-bit) or Version ID (SHA-256) to download. ' +
      'Template ID — downloads the currently deployed version of the template. ' +
      'Version ID — downloads that exact version regardless of deployment status. ' +
      'Both formats are returned by upload_template and list_templates.'
    ),
};

export async function handleDownloadTemplate(
  args: { templateId: string },
  client: CarboneClient,
  options?: CallOptions
) {
  try {
    const result = await client.downloadTemplate(args.templateId, options);
    const ext = result.filename.split('.').pop() ?? 'bin';
    const content = toToolContent(result.buffer, result.filename, ext);
    return { content: [content] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: formatError(error) }],
    };
  }
}
