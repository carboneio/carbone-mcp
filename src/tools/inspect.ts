import { z } from 'zod';
import type { CarboneClient, CallOptions } from '../carbone/client.js';
import type { TemplateDebugInfo } from '../carbone/types.js';
import { INPUT_FORMATS_DESCRIPTION } from '../validation/formats.js';
import { resolveFileInput } from '../utils/file.js';
import { formatError } from '../utils/errors.js';
import type { FileContext } from './output.js';
import { TEMPLATE_XOR_MESSAGE } from './render.js';
import { type IoModes, STDIO_IO, inputForms, inputFormsShort } from './inputForms.js';

// ─── inspect_template ────────────────────────────────────────────────────────

export const inspectTemplateToolName = 'inspect_template';

export function inspectTemplateDescriptionFor(io: IoModes): string {
  return 'List the Carbone tags a template uses and return a sample JSON dataset matching its structure. ' +
    'Call it before render_document when you do not know which data a template expects. ' +
    'Pass exactly one of templateId (a stored template: Template ID or Version ID) or template: ' + inputFormsShort(io) + '. ' +
    'It runs one render on the Carbone account and discards the document. ' +
    '{t()} translation tags are not listed.';
}

/** Default (stdio) wording. */
export const inspectTemplateDescription = inspectTemplateDescriptionFor(STDIO_IO);

export function inspectTemplateSchemaFor(io: IoModes) {
  return {
    templateId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The ID of a stored template to inspect. Two ID formats are accepted: ' +
        '(1) Template ID (64-bit) — the deployed version is inspected. ' +
        '(2) Version ID (SHA-256) — that exact version is inspected. ' +
        'Both are returned by upload_template and list_templates. ' +
        'Mutually exclusive with template — provide exactly one, never both.'
      ),
    template: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Inline template to inspect, without storing it. ' + inputForms(io) + INPUT_FORMATS_DESCRIPTION + ' ' +
        'Mutually exclusive with templateId — provide exactly one, never both.'
      ),
  };
}

/** Default (stdio) wording. */
export const inspectTemplateSchema = inspectTemplateSchemaFor(STDIO_IO);

export const inspectTemplateOutputSchema = {
  tags: z
    .array(z.string())
    .describe(
      'The Carbone tags of the template, as written, e.g. "{d.customer.name}", "{d.items[i].label}", "{c.company}". ' +
      '{t()} translation tags are not listed.'
    ),
  sample: z
    .record(z.string(), z.unknown())
    .describe(
      'A sample dataset matching the template structure, with placeholder values: { "data": {...}, "complement": {...} }. ' +
      'Pass sample.data as render_document data, and sample.complement as complement.'
    ),
  signatures: z.array(z.unknown()).optional().describe('Signature fields found in the template; only present when there are any.'),
  error: z.record(z.string(), z.unknown()).optional().describe('Error reported by Carbone while inspecting; only present when there is one.'),
};

type Inspection = {
  tags: string[];
  sample: Record<string, unknown>;
  signatures?: unknown[];
  error?: Record<string, unknown>;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Keep only the declared fields, in the declared types: the SDK validates structuredContent against the output
 * schema, and the API may send nulls (or extra fields such as metrics), which must never turn into an error.
 */
export function normaliseInspection(debug: TemplateDebugInfo): Inspection {
  const tags = Array.isArray(debug.markers) ? debug.markers.filter((m): m is string => typeof m === 'string') : [];
  const result: Inspection = { tags, sample: isPlainObject(debug.sample) ? debug.sample : {} };
  if (Array.isArray(debug.signatures) && debug.signatures.length > 0) result.signatures = debug.signatures;
  if (isPlainObject(debug.error) && Object.keys(debug.error).length > 0) result.error = debug.error;
  else if (typeof debug.error === 'string' && debug.error) result.error = { message: debug.error };
  return result;
}

function summary(inspection: Inspection): string {
  const lines = inspection.tags.length > 0
    ? [`Carbone tags used by this template (${inspection.tags.length}):`, ...inspection.tags.map((t) => `- ${t}`)]
    : ['No Carbone tags found in this template ({t()} translation tags are not listed).'];
  lines.push('', 'Sample data (JSON):', JSON.stringify(inspection.sample, null, 2));
  if (inspection.signatures) lines.push('', `Signature fields: ${JSON.stringify(inspection.signatures)}`);
  if (inspection.error) lines.push('', `Carbone reported an error: ${JSON.stringify(inspection.error)}`);
  return lines.join('\n');
}

export async function handleInspectTemplate(
  args: { templateId?: string; template?: string },
  client: CarboneClient,
  options?: CallOptions,
  fileCtx?: FileContext
) {
  if ((args.templateId != null) === (args.template != null)) {
    return { isError: true, content: [{ type: 'text' as const, text: TEMPLATE_XOR_MESSAGE }] };
  }

  try {
    // Authenticate first: a caller without credentials must not be able to trigger any URL download.
    client.assertCanAuthenticate(options);

    const debug = args.template != null
      ? await client.inspectTemplate({
          template: await resolveFileInput(args.template, {
            isCloud: client.isCloud,
            maxBytes: fileCtx?.maxFileBytes,
            allowLocalPath: fileCtx?.allowFileInput ?? false,
            allowPrivateNetwork: fileCtx?.allowPrivateNetwork ?? false,
          }),
        }, options)
      : await client.inspectTemplate({ templateId: args.templateId }, options);
    const structuredContent = normaliseInspection(debug);

    return { content: [{ type: 'text' as const, text: summary(structuredContent) }], structuredContent };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: formatError(error) }],
    };
  }
}
