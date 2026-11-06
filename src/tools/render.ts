import { z } from 'zod';
import type { CarboneClient, CallOptions } from '../carbone/client.js';
import {
  CONVERTERS, CONVERTER_DESCRIPTION, INPUT_FORMATS_DESCRIPTION, OUTPUT_FORMAT_DESCRIPTION, OutputFormatSchema, integer,
} from '../validation/formats.js';
import { resolveFileInput, resolveJsonInput } from '../utils/file.js';
import { deliver, oneTimeLinkResult, wantsLink, withReportName, type FileContext } from './output.js';
import { formatError } from '../utils/errors.js';
import {
  type IoModes, STDIO_IO, asAttachmentDescription, defaultDelivery, fieldIf, inputForms, inputFormsShort, jsonRefForms,
  outputPathDescription, returnLinkDescription,
} from './inputForms.js';
import { type ChatFile, acceptsChatAttachments, chatFileSchema, pickFile } from './attachments.js';
import type { Jobs } from '../server/jobs.js';

export const renderDocumentToolName = 'render_document';

/** `failOn` conditions of POST /render, shared with convert_document. */
export const FAIL_ON_CONDITIONS = ['IMAGE_URL_ERROR'] as const;

/** Returned when not exactly one of templateId / template is given (render_document, inspect_template). */
export const TEMPLATE_XOR_MESSAGE = 'Provide either templateId or template, not both (and not neither).';

export function renderDocumentDescriptionFor(io: IoModes): string {
  return 'Generate a document (PDF, DOCX, XLSX, PPTX, ...) by merging JSON data into a Carbone template. ' +
    'Pass templateId for a stored template, or template (' + inputFormsShort(io) + ') for a one-off render. ' +
    'To change the format of a file without data, use convert_document; unsure which data a template expects, ' +
    'call inspect_template first. ' + defaultDelivery(io) + ' ' +
    (io.allowAsync
      ? 'Batches and renders over a minute: pass async: true, then call get_render_result with the job ID.'
      : 'Batches need a webhookUrl the user provides; otherwise render one document per call.');
}

/**
 * The given list or object schema, with its items checked in one pass that stops at the first invalid one: zod
 * reports every invalid item, so a small request could build gigabytes of errors. Adds no size limit, keeps the
 * advertised JSON Schema, and reports the first invalid item as zod would.
 */
export function checkedOnce<T extends z.ZodArray | z.ZodRecord>(schema: T): z.ZodType<z.output<T>, z.input<T>> {
  const isArray = schema instanceof z.ZodArray;
  const item = isArray ? schema.element : schema.valueType;
  const container: z.ZodType<object> = isArray ? z.array(z.unknown()) : z.record(z.string(), z.unknown());
  const { $schema, ...advertised } = z.toJSONSchema(schema);
  return container
    .check((ctx) => {
      const input = ctx.value as Record<PropertyKey, unknown>;
      // keys() for an array: for...in would allocate a string per index
      for (const key of Array.isArray(input) ? input.keys() : Object.keys(input)) {
        const value = input[key];
        if (z.validate(item, value)) continue;
        for (const issue of z.safeParse(item, value).error!.issues) {
          ctx.issues.push({ ...issue, input: value, path: [key, ...issue.path] });
        }
        return;
      }
    })
    .meta(advertised) as unknown as z.ZodType<z.output<T>, z.input<T>>;
}

/** Default (stdio) wording. */
export const renderDocumentDescription = renderDocumentDescriptionFor(STDIO_IO);

export function renderDocumentSchemaFor(io: IoModes) {
  return {
    templateId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'A stored template, from list_templates or upload_template (never guess one): its Template ID (digits, renders ' +
        'the deployed version) or a Version ID (64 hex characters, pins that version). Exclusive with template.'
      ),

    template: z
      .string()
      .min(1)
      .optional()
      .describe(
        'A one-off template, not stored. ' + inputForms(io) + INPUT_FORMATS_DESCRIPTION + ' To reuse one, upload_template ' +
        (io.allowUploadUrl ? '(requestUploadUrl for a large file) ' : '') + 'then pass templateId. Exclusive with templateId.'
      ),

    ...fieldIf(acceptsChatAttachments(io), 'attachedTemplate', chatFileSchema('template', 'template and templateId')),

    data: z
      .union([
        z.record(z.string(), z.unknown()),
        z.array(z.unknown()),
        z.string(),
      ])
      .optional()
      .describe(
        'JSON for the {d.…} tags: an object, a top-level array, or a reference to a JSON file (' + jsonRefForms(io) + '). ' +
        'Omitted: every tag renders empty; to keep tags as written, use keepTags. Tag syntax: the Carbone Skill.'
      ),

    convertTo: OutputFormatSchema
      .optional()
      .describe('Output format, e.g. "pdf". Omitted: the template\'s own format. ' + OUTPUT_FORMAT_DESCRIPTION),

    converter: z
      .enum(CONVERTERS)
      .optional()
      .describe(CONVERTER_DESCRIPTION),

    timezone: z
      .string()
      .optional()
      .describe('IANA time zone for :formatD dates, e.g. "America/New_York". Default "Europe/Paris".'),

    lang: z
      .string()
      .optional()
      .describe('Locale for {t()} translations, :formatN and :formatC, e.g. "fr-fr", "en-us".'),

    complement: z
      .union([z.record(z.string(), z.unknown()), z.string()])
      .optional()
      .describe('Extra data for {c.…} tags (company details, constants), or a reference to a JSON file.'),

    variableStr: z
      .string()
      .optional()
      .describe('Aliases for the whole template, e.g. "{#buyer = d.order.customer}", then {$buyer.name} in it.'),

    reportName: z
      .string()
      .optional()
      .describe('File name without extension; may use tags, e.g. "invoice-{d.id}" (taken literally with keepTags).'),

    enum: z
      .union([z.record(z.string(), z.unknown()), z.string()])
      .optional()
      .describe('Labels for :convEnum(TYPE), e.g. { "STATUS": { "1": "Active" } }, or a reference to a JSON file.'),

    translations: z
      .union([checkedOnce(z.record(z.string(), checkedOnce(z.record(z.string(), z.string())))), z.string()])
      .optional()
      .describe('Strings for {t(key)}, selected by lang: { "fr-fr": { "hello": "Bonjour" } }, or a reference to a JSON file.'),

    currencySource: z
      .string()
      .optional()
      .describe('ISO 4217 currency of the amounts in data, for :formatC. Set with currencyTarget and currencyRates.'),

    currencyTarget: z
      .string()
      .optional()
      .describe('ISO 4217 currency to convert the amounts to.'),

    currencyRates: z
      .union([checkedOnce(z.record(z.string(), z.number())), z.string()])
      .optional()
      .describe('Rates per currency, base 1: { "EUR": 1, "USD": 1.08 }, or a reference to a JSON file.'),

    keepTags: z
      .boolean()
      .optional()
      .describe('If true, skip templating: tags stay as written, to proof a template\'s layout. Exclusive with data.'),

    hardRefresh: z
      .boolean()
      .optional()
      .describe('If true, recompute pagination and the table of contents after rendering. Needs convertTo.'),

    batchSplitBy: z
      .string()
      .optional()
      .describe(
        'One document per item of an array: "d" when data is the array, "d.items" for a child array; at most 100. ' +
        (io.allowAsync
          ? 'Needs async: true (or a webhookUrl the user provides).'
          : 'Needs a webhookUrl the user provides.')
      ),

    batchOutput: z
      .enum(['zip', 'pdf'])
      .optional()
      .describe('Batch result: "zip" (default, named after reportName, or batch.zip without one) or "pdf", one concatenated PDF (needs convertTo "pdf").'),

    batchReportName: z
      .string()
      .optional()
      .describe('Name of each file in the batch ZIP, without extension; tags resolve per item, e.g. "invoice-{d.id}".'),

    preReleaseFeatureIn: integer()
      .optional()
      .describe('Turn on Carbone pre-release features up to this version tag, e.g. 5000000.'),

    failOn: checkedOnce(z.array(z.enum(FAIL_ON_CONDITIONS)))
      .optional()
      .describe('["IMAGE_URL_ERROR"]: fail when an image URL cannot be downloaded, instead of showing a placeholder.'),

    // Offered only when this server runs async renders itself (HTTP with MCP_TICKET_SECRET and a job store).
    ...fieldIf(!!io.allowAsync, 'async', z
      .boolean()
      .optional()
      .describe(
        'If true, render in the background (up to 10 minutes) and return a job ID at once; then call ' +
        'get_render_result with it. For batches and long renders. Exclusive with webhookUrl.'
      )),

    webhookUrl: z
      .url()
      .optional()
      .describe(
        'Only an endpoint the user owns and gives you: Carbone POSTs { "success": true, "data": { "renderId" } } to it ' +
        'when the document is ready, and that server downloads it once. This call then returns no document.' +
        (io.allowAsync ? ' Prefer async: true.' : '')
      ),

    webhookHeaders: checkedOnce(z.record(z.string(), z.string()))
      .optional()
      .describe('Headers Carbone sends to webhookUrl, e.g. { "authorization": "secret" }.'),

    egressAuthorization: z
      .string()
      .max(511)
      .optional()
      .describe('Authorization header value Carbone sends when it fetches images, PDFs or the webhook while rendering.'),

    outputPath: z
      .string()
      .optional()
      .describe(outputPathDescription('generated document')),

    asAttachment: z
      .boolean()
      .optional()
      .describe(asAttachmentDescription(io)),

    returnLink: z
      .boolean()
      .optional()
      .describe(returnLinkDescription(io)),
  };
}

/** Default (stdio) wording, also the shape the validation schemas derive from. */
export const renderDocumentSchema = renderDocumentSchemaFor(STDIO_IO);

export async function handleRenderDocument(
  args: {
    templateId?: string;
    template?: string;
    attachedTemplate?: ChatFile;
    data?: Record<string, unknown> | unknown[] | string;
    convertTo?: z.infer<typeof renderDocumentSchema.convertTo>;
    converter?: (typeof CONVERTERS)[number];
    timezone?: string;
    lang?: string;
    complement?: Record<string, unknown> | string;
    variableStr?: string;
    reportName?: string;
    enum?: Record<string, unknown> | string;
    translations?: Record<string, Record<string, string>> | string;
    currencySource?: string;
    currencyTarget?: string;
    currencyRates?: Record<string, number> | string;
    keepTags?: boolean;
    hardRefresh?: boolean;
    batchSplitBy?: string;
    batchOutput?: 'zip' | 'pdf';
    batchReportName?: string;
    preReleaseFeatureIn?: number;
    failOn?: 'IMAGE_URL_ERROR'[];
    async?: boolean;
    webhookUrl?: string;
    webhookHeaders?: Record<string, string>;
    egressAuthorization?: string;
    outputPath?: string;
    asAttachment?: boolean;
    returnLink?: boolean;
  },
  client: CarboneClient,
  options?: CallOptions,
  fileCtx?: FileContext,
  /** async: who starts the job (callerIdFrom), the only caller get_render_result shows it to. */
  caller = ''
) {
  const { source: templateSource, error } = pickFile(args.template, args.attachedTemplate, ['template', 'attachedTemplate']);
  if (error) return { isError: true, content: [{ type: 'text' as const, text: error }] };

  // XOR: exactly one of templateId or template (or its chat attachment) must be provided
  if ((args.templateId != null) === (templateSource != null)) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: TEMPLATE_XOR_MESSAGE }],
    };
  }

  // Documented batch constraint: concatenating into one PDF requires the documents to BE PDFs.
  if (args.batchOutput === 'pdf' && args.convertTo !== 'pdf'
      && !(typeof args.convertTo === 'object' && args.convertTo?.formatName === 'pdf')) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'batchOutput:"pdf" concatenates the batch into one PDF, so convertTo must be "pdf" too. Use batchOutput:"zip" to bundle other formats.' }],
    };
  }

  if (args.async && args.webhookUrl) {
    return { isError: true, content: [{ type: 'text' as const, text: 'async uses this server\'s own webhook: pass async or webhookUrl, not both.' }] };
  }
  if (args.async && !fileCtx?.jobs) {
    return { isError: true, content: [{ type: 'text' as const, text: 'This server does not run async renders: render without async, or pass a webhookUrl the user provides.' }] };
  }
  // Carbone renders a batch only asynchronously: without a webhook it answers a raw "nbReportMaxPerBatch = 0".
  if (args.batchSplitBy && !args.async && !args.webhookUrl) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: fileCtx?.jobs
          ? 'batchSplitBy needs async: true: add it, then call get_render_result with the job ID.'
          : 'batchSplitBy needs a webhookUrl the user provides; without one, render one document per call.',
      }],
    };
  }

  // keepTags skips templating, so data could never be injected — reject rather than silently drop it.
  if (args.keepTags && args.data != null) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'keepTags:true skips templating, so data cannot be injected. Drop data to keep the tags, or drop keepTags to render the data.' }],
    };
  }

  try {
    // Authenticate first: a caller without credentials must not be able to trigger any URL download.
    client.assertCanAuthenticate(options);

    // Gates apply to the template AND every by-reference JSON param (data, complement, …).
    const resolveOpts = {
      isCloud: client.isCloud,
      maxBytes: fileCtx?.maxFileBytes,
      allowLocalPath: fileCtx?.allowFileInput ?? false,
      allowPrivateNetwork: fileCtx?.allowPrivateNetwork ?? false,
    };
    const template = templateSource
      ? await resolveFileInput(templateSource, resolveOpts)
      : undefined;

    // Object params may be passed inline (object/array) or by reference (path / URL / base64 → parsed JSON).
    // resolveJsonInput passes non-strings (and undefined) through untouched.
    const [data, complement, translations, enumMap, currencyRates] = await Promise.all([
      resolveJsonInput(args.data ?? {}, 'data', resolveOpts),
      resolveJsonInput(args.complement, 'complement', resolveOpts),
      resolveJsonInput(args.translations, 'translations', resolveOpts),
      resolveJsonInput(args.enum, 'enum', resolveOpts),
      resolveJsonInput(args.currencyRates, 'currencyRates', resolveOpts),
    ]);

    // async: this server's own webhook records the result, for get_render_result.
    // A batch delivers a ZIP, or one PDF with batchOutput "pdf": that is what the link will download.
    const resultFormat = args.batchSplitBy ? (args.batchOutput ?? 'zip') : formatNameOf(args.convertTo);
    const job = args.async ? fileCtx!.jobs!.start(caller, resultFormat) : undefined;
    const result = await client.renderDocument({
      ...args,
      ...(job && { webhookUrl: job.webhookUrl, webhookHeaders: job.webhookHeaders }),
      returnLink: wantsLink({ ...args, allowFileOutput: fileCtx?.allowFileOutput ?? false }),
      template,
      data: data as object,
      complement: complement as Record<string, unknown> | undefined,
      translations: translations as Record<string, Record<string, string>> | undefined,
      enum: enumMap as Record<string, unknown> | undefined,
      currencyRates: currencyRates as Record<string, number> | undefined,
    }, options);

    if (job) {
      return {
        content: [{
          type: 'text' as const,
          text: `Rendering in the background. Job ID:\n${job.jobId}\n\n` +
            'Call get_render_result with this job ID in about 5 seconds for the download link, and again while it is ' +
            'still rendering. The result is kept 1 hour.',
        }],
      };
    }

    // Without templating (keepTags), Carbone does not resolve reportName: name the delivered file here instead.
    return deliver(args.keepTags ? withReportName(result, args.reportName, args.convertTo) : result, args.convertTo, {
      outputPath: args.outputPath,
      asAttachment: args.asAttachment,
      allowFileOutput: fileCtx?.allowFileOutput ?? false,
      renderUrl: (id) => client.renderUrl(id),
    });
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: formatError(error) }],
    };
  }
}

/** The format name of a convertTo value, when there is one. */
function formatNameOf(convertTo: z.infer<typeof renderDocumentSchema.convertTo>): string | undefined {
  return typeof convertTo === 'string' ? convertTo : convertTo?.formatName;
}

// ─── get_render_result ───────────────────────────────────────────────────────

export const getRenderResultToolName = 'get_render_result';

export const getRenderResultDescription =
  'Get the result of a render_document call made with async: true: the one-time download link (give it to the user, ' +
  'never open it), the error, or "still rendering" (call again about 5 seconds later; no result after 10 minutes is ' +
  'reported as failed). Results are kept 1 hour, for the caller who started the render.';

export const getRenderResultSchema = {
  jobId: z.string().min(1).max(1024).describe('The job ID render_document returned.'),
};

type RenderResultToolResult = { content: ReturnType<typeof oneTimeLinkResult>['content']; isError?: boolean };

export async function handleGetRenderResult(args: { jobId: string }, client: CarboneClient, jobs: Jobs, caller: string): Promise<RenderResultToolResult> {
  const fail = (text: string): RenderResultToolResult => ({ isError: true, content: [{ type: 'text', text }] });
  try {
    const job = await jobs.status(args.jobId, caller);
    switch (job.status) {
      case 'done':
        return oneTimeLinkResult(client.renderUrl(job.renderId), job.format ?? 'document');
      case 'failed':
        return fail(`The render failed: ${job.error}`);
      case 'unknown':
        return fail('Unknown or expired job ID (results are kept 1 hour): start the render again.');
      default:
        return {
          content: [{
            type: 'text' as const,
            text: 'Still rendering: call get_render_result again in about 5 seconds.',
          }],
        };
    }
  } catch (error) {
    // The store's own error (a path, a status) stays in the server log.
    process.stderr.write(`[carbone-mcp] get_render_result: ${error instanceof Error ? error.message : String(error)}\n`);
    return fail('Could not read the render result: try again in a few seconds.');
  }
}
