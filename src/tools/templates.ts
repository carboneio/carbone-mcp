import { z } from 'zod';
import type { CarboneClient, CallOptions } from '../carbone/client.js';
import type { UploadTemplateResult } from '../carbone/types.js';
import { resolveFileInput } from '../utils/file.js';
import { deliverDocument, type FileContext } from './output.js';
import { formatError } from '../utils/errors.js';
import { INPUT_FORMATS_DESCRIPTION, integer } from '../validation/formats.js';
import { type IoModes, STDIO_IO, fieldIf, inputForms, outputPathDescription } from './inputForms.js';
import { type ChatFile, acceptsChatAttachments, chatFileSchema, pickFile } from './attachments.js';
import type { UploadCaller } from '../server/upload.js';

// The Carbone API's rule: non-empty strings whose list, without duplicates, is at most 100 characters as JSON.
// The caps keep the work bounded: 100 tags, checked before the items (one error rather than one per invalid
// item, which can exhaust memory), and 96 characters per tag (the API's longest); the list is serialized only
// once every tag has passed.
const tagsSchema = z
  .array(z.string().min(1).max(96))
  .max(100)
  .refine((tags) => JSON.stringify([...new Set(tags)]).length <= 100, {
    message: 'The tag list is limited to 100 characters (about 8 tags of 9 characters).',
    when: ({ issues }) => issues.length === 0,
  });

// ─── list_templates ──────────────────────────────────────────────────────────

export const listTemplatesToolName = 'list_templates';

export const listTemplatesDescription =
  'List stored templates, with filters and pagination. Each result has an id (Template ID; null for a template ' +
  'uploaded with versioning: false) and a versionId: pass either as templateId to render_document, download_template ' +
  'or delete_template. Each result lists its tags: to find templates by tag, keep the results whose tags include it.';

export const listTemplatesOutputSchema = {
  templates: z.array(z.record(z.string(), z.unknown())).describe('The matching templates (all fields).'),
  hasMore: z.boolean().describe('Whether more results are available via the cursor.'),
  nextCursor: z.string().optional().describe('Cursor to pass to the next list_templates call.'),
};

/**
 * A Template ID (64-bit) is written with digits only; the API refuses anything else with a 400 from v5.16.0
 * (an empty string, a Version ID, ' 12 ', '0x1F'...). Checked here so the message names the field.
 */
const templateId64 = (role: string) =>
  z.string().regex(/^\d+$/, `${role} must be a Template ID (64-bit format, digits only, e.g. "1530905183164918624"), not a Version ID (SHA-256).`);

export const listTemplatesSchema = {
  id: templateId64('id')
    .optional()
    .describe('Filter by Template ID (64-bit format, digits only). Cannot be a Version ID.'),
  versionId: z
    .string()
    .optional()
    .describe('Filter by Version ID (SHA-256 format).'),
  category: z
    .string()
    .optional()
    .describe('Filter by category (e.g. "invoices", "legal").'),
  origin: integer()
    .optional()
    .describe('Upload origin: 0 API (this server), 1 Carbone Studio, 2 Salesforce, 3 Odoo, 4 HubSpot.'),
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
    .describe('1 to 100 results (default 100); use cursor for more.'),
  cursor: z
    .string()
    .optional()
    .describe('The nextCursor of the previous response.'),
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

/** upload_template: which inputs carry the file depends on the transport. */
export function uploadTemplateDescriptionFor(io: IoModes): string {
  const inputs = ['template', ...(acceptsChatAttachments(io) ? ['attachedTemplate'] : []), ...(io.allowUploadUrl ? ['requestUploadUrl'] : [])];
  return 'Store a reusable template, then render it with render_document and its Template ID. ' +
    (inputs.length > 1 ? `Pass exactly one of ${inputs.join(', ')}. ` : '') +
    'Returns id (Template ID) and versionId. A new version of an existing template (id) is used by renders only once ' +
    'deployed (deployedAt).';
}

/** Default (stdio) wording. */
export const uploadTemplateDescription = uploadTemplateDescriptionFor(STDIO_IO);

export const uploadTemplateOutputSchema = {
  id: z.string().optional().describe('Stable Template ID (when versioning is enabled).'),
  versionId: z.string().optional().describe('Version ID (SHA-256) of this uploaded version.'),
  templateId: z.string().optional().describe('versioning: false only: the Version ID (SHA-256) of the upload, not a Template ID.'),
  templateExtension: z.string().optional().describe('Detected file extension, e.g. "docx" (legacy/non-versioned mode).'),
  name: z.string().optional().describe('Template display name, when one was given.'),
  type: z.string().optional().describe('Detected template file type.'),
  size: z.number().optional().describe('Template size in bytes.'),
  createdAt: z.number().optional().describe('UTC Unix timestamp (seconds) of the upload.'),
  deployedAt: z
    .number()
    .optional()
    .describe('UTC Unix timestamp of deployment; 0 means this version is not explicitly deployed.'),
  uploadUrl: z.string().optional().describe('requestUploadUrl only: POST the file here as the raw body; the answer is the stored template. Nothing is stored before.'),
  headers: z.record(z.string(), z.string()).optional().describe('requestUploadUrl only: the headers to send with the file.'),
  expiresAt: z.number().optional().describe('requestUploadUrl only: UTC Unix timestamp after which the URL is refused.'),
};

/** The upload URL mode's input: the file the URL will accept, and only that file. */
const requestUploadUrlSchema = z
  .strictObject({
    size: integer(1).describe('The file size in bytes, e.g. from `wc -c < file`.'),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).describe('The file SHA-256 in hex, e.g. from `sha256sum file` (or `shasum -a 256 file`).'),
  })
  .optional()
  .describe(
    'Instead of template, when you can run shell commands: the file size and SHA-256. Returns uploadUrl and headers, ' +
    'valid 10 minutes for that file only: POST the file as the raw body with those headers (curl -H \'<name>: <value>\' ' +
    '--data-binary @<file> <uploadUrl>); the answer is the stored template (id, versionId). Prefer it to base64 for ' +
    'any file over a few KB. Not with template, attachedTemplate or sample.'
  );

export function uploadTemplateSchemaFor(io: IoModes) {
  const template = z.string().min(1);
  return {
    // With a chat attachment on offer, template is checked at runtime instead: it is required unless attachedTemplate is set.
    template: (acceptsChatAttachments(io) ? template.optional() : template)
      .describe('The template file. ' + inputForms(io) + INPUT_FORMATS_DESCRIPTION),
    ...fieldIf(acceptsChatAttachments(io), 'attachedTemplate', chatFileSchema('template')),
    // Offered only when this server issues upload URLs (HTTP with MCP_TICKET_SECRET).
    ...fieldIf(!!io.allowUploadUrl, 'requestUploadUrl', requestUploadUrlSchema),
    name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Display name, shown and searched by list_templates (max 200 characters).' +
        (acceptsChatAttachments(io) ? ' Defaults to the attached file name.' : '')
      ),
    id: templateId64('id')
      .optional()
      .describe('Template ID (digits) to add this upload to as a new version; omitted: a new template. Never a Version ID.'),
    versioning: z
      .boolean()
      .optional()
      .default(true)
      .describe('Leave true (default). false is legacy: no Template ID, only a SHA-256 templateId.'),
    category: z
      .string()
      .max(200)
      .optional()
      .describe('Category, e.g. "invoices" (max 200 characters).'),
    comment: z
      .string()
      .max(200)
      .optional()
      .describe('Comment on this version (max 200 characters).'),
    tags: tagsSchema
      .optional()
      .describe('Labels, e.g. ["sales", "billing"]: sorted, deduplicated, 100 characters in all.'),
    sample: z
      .array(
        z.strictObject({
          data:         z.record(z.string(), z.unknown()).optional(),
          complement:   z.record(z.string(), z.unknown()).optional(),
          translations: z.record(z.string(), z.unknown()).optional(),
          enum:         z.record(z.string(), z.unknown()).optional(),
        })
      )
      .max(1)
      .optional()
      .describe('A sample dataset stored with the template, at most one: [{ "data": { "name": "Acme" } }].'),
    deployedAt: integer()
      .optional()
      .describe('42000000000 deploys this version now: renders by Template ID use the most recently deployed version.'),
    expireAt: integer(0)
      .optional()
      .describe('Delete the template at this UTC Unix time (seconds); 0 (default) never. To delete now, use delete_template.'),
  };
}

/** Default (stdio) wording, also the shape the validation schemas derive from. */
export const uploadTemplateSchema = uploadTemplateSchemaFor(STDIO_IO);

/**
 * The text and structured result of a stored upload, for upload_template and for the upload URL route (whose JSON
 * response has the same fields). The API returns different shapes depending on whether versioning is enabled.
 */
export function describeUpload(result: UploadTemplateResult, name: string | undefined): { text: string; structuredContent: Record<string, unknown> } {
  const lines: string[] = ['Template uploaded successfully!', ''];
  const structuredContent: Record<string, unknown> = name ? { name } : {};
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
  if (name) lines.push(`Name        : ${name}`);

  return { text: lines.join('\n'), structuredContent };
}

/** upload_template's tool result: text, plus the structured fields on success. */
type UploadToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean; structuredContent?: Record<string, unknown> };

/** requestUploadUrl: an upload URL for this file only, and the command to send it; nothing is stored yet. */
function issueUploadUrl(
  { size, sha256 }: { size: number; sha256: string },
  args: Parameters<typeof handleUploadTemplate>[0],
  client: CarboneClient,
  options: CallOptions | undefined,
  fileCtx: FileContext | undefined,
  caller: UploadCaller | undefined
): UploadToolResult {
  const fail = (text: string): UploadToolResult => ({ isError: true, content: [{ type: 'text', text }] });
  if (args.template != null || args.attachedTemplate != null) {
    return fail('requestUploadUrl replaces template: pass one or the other, not both.');
  }
  if (args.sample) {
    return fail('sample cannot be sent with requestUploadUrl. Upload without sample, or pass the file in template.');
  }
  if (!fileCtx?.uploads) return fail('This server does not issue upload URLs: pass the file in template.');
  if (size > fileCtx.maxFileBytes) {
    return fail(`The file is ${size} bytes, over this server's limit of ${fileCtx.maxFileBytes} bytes.`);
  }
  try {
    client.assertCanAuthenticate(options);
    // The template fields, listed: nothing else from the call goes into the ticket.
    const { versioning = true, id, name, category, comment, tags, deployedAt, expireAt } = args;
    const issued = fileCtx.uploads.issue(
      { size, sha256, fields: { versioning, id, name, category, comment, tags, deployedAt, expireAt } },
      caller ?? { id: '', credential: { serverKey: true } }
    );
    const headerFlags = Object.entries(issued.headers).map(([name, value]) => `-H '${name}: ${value}'`).join(' ');
    const text = [
      `NOT uploaded yet. Send the file before ${new Date(issued.expiresAt * 1000).toISOString()} with:`,
      '',
      `curl -sS ${headerFlags} --data-binary @<file> ${issued.uploadUrl}`,
      '',
      'Replace <file> with its path. The command prints the stored template as JSON (id, versionId, ...). ' +
      `The URL accepts only this file (${size} bytes, this SHA-256): any other is refused and nothing is stored. ` +
      'If the request cannot reach the server, the code sandbox network settings may have to allow its domain.',
    ].join('\n');
    return { content: [{ type: 'text' as const, text }], structuredContent: { ...issued } };
  } catch (error) {
    return fail(formatError(error));
  }
}

export async function handleUploadTemplate(
  args: {
    template?:   string;
    attachedTemplate?: ChatFile;
    requestUploadUrl?: { size: number; sha256: string };
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
  fileCtx?: FileContext,
  caller?: UploadCaller
): Promise<UploadToolResult> {
  if (args.requestUploadUrl) return issueUploadUrl(args.requestUploadUrl, args, client, options, fileCtx, caller);

  const { source, error } = pickFile(args.template, args.attachedTemplate, ['template', 'attachedTemplate']);
  if (error || source == null) {
    return { isError: true, content: [{ type: 'text' as const, text: error ?? 'Provide the template file in template.' }] };
  }
  // An attached file keeps its own name in the template list unless the caller names it.
  const name = args.name ?? args.attachedTemplate?.file_name?.slice(0, 200);

  try {
    // Authenticate first: a caller without credentials must not be able to trigger any URL download.
    client.assertCanAuthenticate(options);

    const template = await resolveFileInput(source, {
      isCloud: client.isCloud,
      maxBytes: fileCtx?.maxFileBytes,
      allowLocalPath: fileCtx?.allowFileInput ?? false,
      allowPrivateNetwork: fileCtx?.allowPrivateNetwork ?? false,
    });
    const result: UploadTemplateResult = await client.uploadTemplate({ ...args, name, template }, options);

    const { text, structuredContent } = describeUpload(result, name);
    return { content: [{ type: 'text' as const, text }], structuredContent };
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
  'Change ONE template version: name, comment, category, tags, deployment (deployedAt), scheduled deletion ' +
  '(expireAt), or the Template ID it belongs to (moveToTemplateId). A Template ID patches its deployed version; a ' +
  'Version ID, that exact version. To delete now, use delete_template.';

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
    .describe('The version to change: a Version ID, or a Template ID for its deployed version.'),
  moveToTemplateId: templateId64('moveToTemplateId')
    .optional()
    .describe(
      'Only when the user asks to move a version: moves it to this other Template ID (digits). Not the template to ' +
      'change (that is templateId).'
    ),
  // DEPRECATED: the 1.6.0 name of moveToTemplateId, kept so existing callers keep working, but not listed in
  // tools/list (src/tools/index.ts), so models never see it. Passing both with different values is rejected.
  id: templateId64('id').optional(),
  name: z.string().max(200).optional().describe('New name (max 200 characters).'),
  comment: z.string().max(200).optional().describe('New comment (max 200 characters).'),
  category: z.string().max(200).optional().describe('New category (max 200 characters).'),
  tags: tagsSchema
    .optional()
    .describe('New tags, replacing the current ones: sorted, deduplicated, 100 characters in all.'),
  deployedAt: integer()
    .optional()
    .describe('42000000000 deploys this version now: renders by Template ID use the most recently deployed version.'),
  expireAt: integer(0)
    .optional()
    .describe('Delete this version at this UTC Unix time (seconds); 0 cancels a scheduled deletion.'),
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
  'Delete a stored template now: a Template ID removes every version, a Version ID only that one. Confirm with the ' +
  'user first: it cannot be undone. To schedule a deletion instead, use update_template_metadata with expireAt.';

export const deleteTemplateSchema = {
  templateId: z
    .string()
    .min(1)
    .describe('Template ID (every version) or Version ID (that version only), from list_templates.'),
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
  'List the template categories in use, for the category filter of list_templates or upload_template.';

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
  'List the tags in use across templates. To find the templates with a tag, call list_templates and keep the ' +
  'results whose tags include it.';

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

export function downloadTemplateDescriptionFor(io: IoModes): string {
  return 'Download a stored template\'s original file (DOCX, XLSX, HTML...), or with sample: true the sample dataset ' +
    'stored with it. ' + (io.allowFileOutput
      ? 'Text and images come back inline; other files are saved to a temp file whose path is returned.'
      : 'Text and images come back inline; other files as a base64 attachment, which some clients such as claude.ai cannot open.');
}

/** Default (stdio) wording. */
export const downloadTemplateDescription = downloadTemplateDescriptionFor(STDIO_IO);

export function downloadTemplateSchemaFor(io: IoModes) {
  return {
    templateId: z
      .string()
      .min(1)
      .describe('Template ID (its deployed version) or Version ID, from list_templates.'),
    sample: z
      .boolean()
      .optional()
      .describe('If true, return the sample dataset stored at upload, as JSON, instead of the file; an error if there is none.'),
    outputPath: z
      .string()
      .optional()
      .describe(outputPathDescription('template file')),
    asAttachment: z
      .boolean()
      .optional()
      .describe('If true, return a text or image file as a base64 attachment too.'),
  };
}

/** Default (stdio) wording, also the shape the validation schemas derive from. */
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
