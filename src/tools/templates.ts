import { z } from 'zod';
import type { CarboneClient, CallOptions } from '../carbone/client.js';
import type { UploadTemplateResult } from '../carbone/types.js';
import { resolveFileInput } from '../utils/file.js';
import { deliverDocument, type FileContext } from './output.js';
import { formatError } from '../utils/errors.js';
import { INPUT_FORMATS_DESCRIPTION } from '../validation/formats.js';
import { type IoModes, STDIO_IO, inputForms, outputPathDescription } from './inputForms.js';

// ─── list_templates ──────────────────────────────────────────────────────────

export const listTemplatesToolName = 'list_templates';

export const listTemplatesDescription =
  'List stored Carbone templates with filtering, search, and pagination. ' +
  'Filter by Template ID, Version ID, category, or upload origin. ' +
  'Use includeVersions to see the full version history of each template. ' +
  'Supports cursor-based pagination for large collections. ' +
  'Note: filtering by tags is not supported by the Carbone API — use list_tags to discover tags, then filter results manually. ' +
  'Note: templates uploaded with versioning disabled appear with id = null and are identified only by their versionId — pass that versionId where a Template ID is expected (e.g. delete_template, download_template).';

export const listTemplatesOutputSchema = {
  templates: z.array(z.record(z.string(), z.unknown())).describe('The matching templates (all fields).'),
  hasMore: z.boolean().describe('Whether more results are available via the cursor.'),
  nextCursor: z.string().optional().describe('Cursor to pass to the next list_templates call.'),
};

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
    .describe(
      'Filter by upload origin: 0 = API, 1 = Carbone Studio, 2 = Salesforce integration, ' +
      '3 = Odoo integration, 4 = HubSpot integration. Templates uploaded through this MCP server are origin 0.'
    ),
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
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum number of results to return, between 1 and 100 (Carbone API limit). Default: 100. Use cursor to page beyond that.'),
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
    const { templates, hasMore, nextCursor } = await client.listTemplates(args, options);

    const structuredContent = { templates, hasMore, ...(nextCursor ? { nextCursor } : {}) };

    if (templates.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No templates found.' }], structuredContent };
    }

    // Compact JSON (no indentation) keeps every field while cutting token cost.
    let text = JSON.stringify(templates);
    if (hasMore && nextCursor) {
      text += `\n\nMore results available. Call list_templates again with cursor="${nextCursor}" to fetch the next page.`;
    }

    return { content: [{ type: 'text' as const, text }], structuredContent };
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
  'and rendering by Template ID uses the version with the most recent deployedAt. ' +
  'A result deployedAt of 0 means the version is not explicitly deployed: if another version of the same ' +
  'Template ID is deployed, renders by Template ID keep using that one. ' +
  'Accepted formats: DOCX, XLSX, PPTX, ODT, ODS, ODP, ODG, HTML, XHTML, XML, SVG, IDML, Markdown, TXT, CSV, RTF and PDF ' +
  '(not the legacy binary DOC, XLS or PPT).';

export const uploadTemplateOutputSchema = {
  id: z.string().optional().describe('Stable Template ID (when versioning is enabled).'),
  versionId: z.string().optional().describe('Version ID (SHA-256) of this uploaded version.'),
  templateId: z.string().optional().describe('Template ID returned in legacy/non-versioned mode.'),
  templateExtension: z.string().optional().describe('Detected file extension, e.g. "docx" (legacy/non-versioned mode).'),
  name: z.string().optional().describe('Template display name, when one was given.'),
  type: z.string().optional().describe('Detected template file type.'),
  size: z.number().optional().describe('Template size in bytes.'),
  createdAt: z.number().optional().describe('UTC Unix timestamp (seconds) of the upload.'),
  deployedAt: z
    .number()
    .optional()
    .describe('UTC Unix timestamp of deployment; 0 means this version is not explicitly deployed.'),
};

export function uploadTemplateSchemaFor(io: IoModes) {
  return {
    template: z
      .string()
      .min(1)
      .describe(
        'The template file. ' + inputForms(io) + INPUT_FORMATS_DESCRIPTION
      ),
    name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Display name for the template, max 200 characters (e.g. "Invoice Template", "NDA Contract"). ' +
        'Optional but recommended: list_templates shows it and its search matches it.'
      ),
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
        'When false, behaves as legacy mode and returns only a templateId (SHA-256 hash) and templateExtension.'
      ),
    category: z
      .string()
      .max(200)
      .optional()
      .describe('Group templates into folders/categories, max 200 characters (e.g. "invoices", "legal", "hr").'),
    comment: z
      .string()
      .max(200)
      .optional()
      .describe('Free-text comment to describe the template version or its purpose, max 200 characters.'),
    tags: z
      .array(z.string())
      .optional()
      .describe(
        'Labels shown by list_tags (e.g. ["sales", "billing", "v2"]); list_templates cannot filter by tag. ' +
        'Duplicates are removed and the list is sorted; the whole list is limited to 100 characters (about 8 tags of 9 characters).'
      ),
    sample: z
      .array(
        z.strictObject({
          data:         z.record(z.string(), z.unknown()).optional().describe('JSON dataset for {d.} tags.'),
          complement:   z.record(z.string(), z.unknown()).optional().describe('Extra data for {c.} tags.'),
          translations: z.record(z.string(), z.unknown()).optional().describe('Localization map for {t()} tags.'),
          enum:         z.record(z.string(), z.unknown()).optional().describe('Enumerations for :convEnum() formatter.'),
        })
      )
      .max(1)
      .optional()
      .describe(
        'Sample input data attached to the template for testing in Carbone Studio: an array with at most ONE object, ' +
        'whose keys data, complement, translations and enum are all optional. Example: [{ "data": { "name": "Acme" } }].'
      ),
    deployedAt: z
      .number()
      .int()
      .optional()
      .describe(
        'UTC Unix timestamp (seconds) to set as the deployment time for this version. ' +
        'Carbone uses the version with the most recent deployedAt when rendering via Template ID. ' +
        'Use 42000000000 to deploy immediately (special "NOW" sentinel value). Future values are not allowed.'
      ),
    expireAt: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'Schedule deletion at a UTC Unix timestamp (seconds); 0 (default) means the template never expires. ' +
        'After that time it is no longer listed, downloadable or renderable (404), and the file is purged after ' +
        'the retention delay. To remove a template now, use delete_template.'
      ),
  };
}

/** Default (stdio) wording — also the shape the validation schemas derive from. */
export const uploadTemplateSchema = uploadTemplateSchemaFor(STDIO_IO);

export async function handleUploadTemplate(
  args: {
    template:    string;
    name?:       string;
    id?:         string;
    versioning?: boolean;
    category?:   string;
    comment?:    string;
    tags?:       string[];
    sample?:     Array<{ data?: Record<string, unknown>; complement?: Record<string, unknown>; translations?: Record<string, unknown>; enum?: Record<string, unknown> }>;
    deployedAt?: number;
    expireAt?:   number;
  },
  client: CarboneClient,
  options?: CallOptions,
  fileCtx?: FileContext
) {
  try {
    const template = await resolveFileInput(args.template, {
      isCloud: client.isCloud,
      maxBytes: fileCtx?.maxFileBytes,
      allowLocalPath: fileCtx?.allowFileInput ?? false,
      allowPrivateNetwork: fileCtx?.allowPrivateNetwork ?? false,
    });
    const result: UploadTemplateResult = await client.uploadTemplate({ ...args, template }, options);

    // The API returns different shapes depending on whether versioning is enabled
    const lines: string[] = ['Template uploaded successfully!', ''];
    const structuredContent: Record<string, unknown> = args.name ? { name: args.name } : {};
    if ('id' in result) {
      lines.push(`Template ID : ${result.id}`);
      lines.push(`Version ID  : ${result.versionId}`);
      structuredContent['id'] = result.id;
      structuredContent['versionId'] = result.versionId;
      if (result.type) { lines.push(`Type        : ${result.type}`); structuredContent['type'] = result.type; }
      if (result.size) { lines.push(`Size        : ${result.size} bytes`); structuredContent['size'] = result.size; }
      if (result.createdAt) structuredContent['createdAt'] = result.createdAt;
      // Renders by Template ID use the most recently deployed version. With deployedAt 0, they keep using another
      // deployed version if there is one; a fresh Template ID still renders (verified live).
      if (result.deployedAt != null) { // null: absent (the output schema rejects it)
        structuredContent['deployedAt'] = result.deployedAt;
        lines.push(result.deployedAt > 0
          ? `Deployed at : ${result.deployedAt} (renders by Template ID use the most recently deployed version)`
          : 'Deployed at : 0 (not explicitly deployed: if another version of this Template ID is deployed, ' +
            'renders by Template ID keep using it). To use this version, deploy it with update_template_metadata ' +
            '(templateId = this Version ID, deployedAt = 42000000000), or render it by its Version ID.');
      }
    } else {
      // Legacy / versioning disabled response
      lines.push(`Template ID : ${result.templateId}`);
      structuredContent['templateId'] = result.templateId;
      if (result.templateExtension) {
        lines.push(`Extension   : ${result.templateExtension}`);
        structuredContent['templateExtension'] = result.templateExtension;
      }
    }
    if (args.name) lines.push(`Name        : ${args.name}`);

    return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent };
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
  'Update the metadata of ONE stored template version: name, comment, category, tags, deployment (deployedAt), ' +
  'scheduled deletion (expireAt), or the Template ID it belongs to (moveToTemplateId). ' +
  'With a Template ID, Carbone patches its currently deployed version only; with a Version ID, that exact version. ' +
  'Use deployedAt to choose the version used when rendering by Template ID. ' +
  'Returns the patched versionId and the updated fields, as echoed back by Carbone. To delete a template now, use delete_template.';

export const updateTemplateMetadataOutputSchema = {
  versionId: z.string().describe('Version ID of the patched version.'),
  id: z.string().optional().describe('Template ID the version now belongs to (returned when moveToTemplateId was used).'),
  name: z.string().optional().describe('Name, returned if updated.'),
  comment: z.string().optional().describe('Comment, returned if updated.'),
  category: z.string().optional().describe('Category, returned if updated.'),
  tags: z.array(z.string()).optional().describe('Tags, returned if updated.'),
  deployedAt: z.number().optional().describe('Deployment timestamp, returned if updated.'),
  expireAt: z.number().optional().describe('Deletion timestamp (0 = never expires), returned if updated.'),
};

export const updateTemplateMetadataSchema = {
  templateId: z
    .string()
    .min(1)
    .describe(
      'Template ID (64-bit) or Version ID (SHA-256) of the version to update. ' +
      'A Template ID patches only its currently deployed version (not every version). ' +
      'A Version ID patches that exact version.'
    ),
  moveToTemplateId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'CAUTION, structural change: moves the patched version to this other Template ID (64-bit; a Version ID is rejected). ' +
      'It is NOT the template to patch (that is templateId). ' +
      'Pass the version\'s Version ID as templateId; with a Template ID, its currently deployed version is moved and ' +
      'that Template ID falls back to its next most recent version (or stops resolving if none is left). ' +
      'Fails if the move creates a deployedAt conflict at the destination. Only use it when the user asks to move a version.'
    ),
  id: z
    .string()
    .min(1)
    .optional()
    .describe(
      'DEPRECATED: the 1.6.0 name of moveToTemplateId, kept so existing callers keep working. Use moveToTemplateId; ' +
      'passing both with different values is rejected.'
    ),
  name: z.string().max(200).optional().describe('New display name, max 200 characters.'),
  comment: z.string().max(200).optional().describe('New free-text comment, max 200 characters.'),
  category: z.string().max(200).optional().describe('New category, max 200 characters.'),
  tags: z
    .array(z.string())
    .optional()
    .describe(
      'New list of tags, replacing the existing ones. Duplicates are removed and the list is sorted; ' +
      'the whole list is limited to 100 characters (about 8 tags of 9 characters).'
    ),
  deployedAt: z
    .number()
    .int()
    .optional()
    .describe(
      'Unix timestamp (seconds) to set as the deployment time for this version. ' +
      'Carbone picks the version with the most recent deployedAt when rendering by Template ID. ' +
      'Use 42000000000 to deploy immediately (special "NOW" value). ' +
      'Future values are not allowed, and the deployed version\'s deployedAt cannot move back in time.'
    ),
  expireAt: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Schedule deletion of the patched version at a UTC Unix timestamp (seconds). After that time it is no longer ' +
      'listed, downloadable or renderable (404), and the file is purged after the retention delay. ' +
      'Send 0 to cancel a scheduled deletion (permanent again); omit to leave it unchanged. ' +
      'To delete now, use delete_template.'
    ),
};

export async function handleUpdateTemplateMetadata(
  args: {
    templateId:  string;
    moveToTemplateId?: string;
    /** Deprecated 1.6.0 alias of moveToTemplateId. */
    id?:         string;
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
  // moveToTemplateId is the API body field `id` (renamed so it is not confused with templateId). 1.6.0 exposed it
  // as `id`, still accepted as a deprecated alias: either one maps to the body `id`, never two different values.
  const { moveToTemplateId, id: deprecatedId, ...fields } = args;
  if (moveToTemplateId !== undefined && deprecatedId !== undefined && moveToTemplateId !== deprecatedId) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: `Conflicting destinations: moveToTemplateId "${moveToTemplateId}" and id "${deprecatedId}". ` +
          'id is the deprecated name of moveToTemplateId: pass only moveToTemplateId.',
      }],
    };
  }

  try {
    const result = await client.updateTemplate({ ...fields, id: moveToTemplateId ?? deprecatedId }, options);

    // Keep only the declared fields: the output schema rejects unknown keys. Treat null as absent too:
    // the live API echoes "deployedAt": null even when it was not sent, which the schema would reject.
    const { versionId, id, name, comment, category, tags, deployedAt, expireAt } = result;
    const updated = Object.fromEntries(
      Object.entries({ id, name, comment, category, tags, deployedAt, expireAt }).filter(([, v]) => v != null)
    );
    // A Version ID in the URL is echoed back as versionId; anything else was a Template ID.
    const target = versionId === args.templateId
      ? `version ${versionId}`
      : `version ${versionId} (the currently deployed version of Template ID ${args.templateId})`;

    return {
      content: [{ type: 'text' as const, text: `Template metadata updated for ${target}.\nUpdated fields: ${JSON.stringify(updated)}` }],
      structuredContent: { versionId, ...updated },
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
  'Delete a stored Carbone template. Takes effect immediately: the template is no longer listed, downloadable ' +
  'or renderable (404); the file itself is purged after the retention delay (Carbone Cloud: 24 hours). ' +
  'You can delete by Template ID (removes all versions) or by Version ID (removes only that specific version). ' +
  'To schedule a deletion instead, use update_template_metadata with expireAt set to a future Unix timestamp.';

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

export const listCategoriesOutputSchema = {
  categories: z.array(z.string()).describe('Template category names in use.'),
};

export async function handleListCategories(
  _args: Record<string, never>,
  client: CarboneClient,
  options?: CallOptions
) {
  try {
    const categories = await client.getCategories(options);

    if (categories.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No categories found.' }], structuredContent: { categories: [] } };
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(categories) }],
      structuredContent: { categories },
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

export const listTagsOutputSchema = {
  tags: z.array(z.string()).describe('Template tag names in use.'),
};

export async function handleListTags(
  _args: Record<string, never>,
  client: CarboneClient,
  options?: CallOptions
) {
  try {
    const tags = await client.getTags(options);

    if (tags.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No tags found.' }], structuredContent: { tags: [] } };
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(tags) }],
      structuredContent: { tags },
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
  'Pass a Template ID to download the currently deployed version, or a Version ID to download a specific version. ' +
  'Set sample: true to get the JSON sample dataset stored with the template instead of the template file.';

export function downloadTemplateSchemaFor(io: IoModes) {
  return {
    templateId: z
      .string()
      .min(1)
      .describe(
        'Template ID (64-bit) or Version ID (SHA-256) to download. ' +
        'Template ID — downloads the currently deployed version of the template. ' +
        'Version ID — downloads that exact version regardless of deployment status. ' +
        'Both formats are returned by upload_template and list_templates.'
      ),
    sample: z
      .boolean()
      .optional()
      .describe(
        'If true, download the JSON SAMPLE DATASET saved with the template (the "sample" array passed to ' +
        'upload_template) instead of the template file, returned as inline JSON text by default, of the form ' +
        '[{ "data": {...}, "complement": {...}, "translations": {...}, "enum": {...} }] (each key optional). ' +
        'Use it to recover the example data a template expects before calling render_document. ' +
        'Errors if the template was uploaded without a sample.'
      ),
    outputPath: z
      .string()
      .optional()
      .describe(outputPathDescription('template file', io)),
    asAttachment: z
      .boolean()
      .optional()
      .describe(
        'If true, return the template as a downloadable file attachment (base64 resource) instead of inline ' +
        'text/image. Useful in HTTP mode where outputPath is unavailable. Default: false. Ignored when outputPath is set.'
      ),
  };
}

/** Default (stdio) wording — also the shape the validation schemas derive from. */
export const downloadTemplateSchema = downloadTemplateSchemaFor(STDIO_IO);

export async function handleDownloadTemplate(
  args: { templateId: string; outputPath?: string; asAttachment?: boolean; sample?: boolean },
  client: CarboneClient,
  options?: CallOptions,
  fileCtx?: FileContext
) {
  try {
    // An ID already carrying the "_sample.json" path suffix (the raw API form) is treated like sample: true.
    const sample = args.sample === true || args.templateId.endsWith('_sample.json');
    const templateId = sample ? args.templateId.replace(/_sample\.json$/, '') : args.templateId;
    const result = await client.downloadTemplate(templateId, { ...options, sample });
    // A sample is JSON whatever the template's own type: take the extension from the request (delivered inline as
    // application/json), as the returned filename may lack it.
    const ext = sample ? 'json' : (result.filename.split('.').pop() ?? 'bin');

    return deliverDocument({
      buffer: result.buffer,
      filename: result.filename,
      format: ext,
      outputPath: args.outputPath,
      asAttachment: args.asAttachment,
      allowFileOutput: fileCtx?.allowFileOutput ?? false,
    });
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: formatError(error) }],
    };
  }
}
