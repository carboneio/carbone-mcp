import { z } from 'zod';
import type { CarboneClient, CallOptions } from '../carbone/client.js';
import { CONVERTERS, CONVERTER_DESCRIPTION, OUTPUT_FORMAT_DESCRIPTION, OutputFormatSchema } from '../validation/formats.js';
import { resolveFileInput, resolveJsonInput } from '../utils/file.js';
import { deliver, type FileContext } from './output.js';
import { formatError } from '../utils/errors.js';

export const renderDocumentToolName = 'render_document';

export const renderDocumentDescription =
  'Generate a document by merging a Carbone template with JSON data. ' +
  'Two modes: (1) pass templateId to use a previously uploaded template; ' +
  '(2) pass template (file path, URL, or base64) to upload and render in a single request without storing a template. ' +
  'Supports output format conversion, multilingual rendering, currency conversion, ' +
  'batch generation, and advanced PDF options (watermark, password, PDF/A). ' +
  'Without data, every tag resolves to empty; to convert a file and keep its tags, use convert_document. ' +
  'Async mode: pass webhookUrl. This tool then returns only Carbone\'s acceptance message, never the document: ' +
  'Carbone POSTs { "success": true, "data": { "renderId": "..." } } to the webhook, whose server downloads the document ' +
  'itself from GET /render/{renderId} (one-time, no auth). You cannot fetch it from here. ' +
  'Batch generation (batchSplitBy) is always delivered this way.';

export const renderDocumentSchema = {
  templateId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'The ID of a previously uploaded template to render. Two ID formats are accepted: ' +
      '(1) Template ID (64-bit) — stable identifier shared across versions; Carbone automatically uses the deployed version. ' +
      '(2) Version ID (SHA-256) — pins rendering to a specific version regardless of deployment status. ' +
      'Both are returned by upload_template. ' +
      'Mutually exclusive with template — provide exactly one, never both.'
    ),

  template: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Inline template for one-shot render without storing a template first. ' +
      'Accepts a local file path (e.g. /home/user/invoice.docx), ' +
      'a URL (https://example.com/template.docx), or a base64-encoded string. ' +
      'The template is uploaded and rendered in a single API request — no Template ID is returned. ' +
      'Use this for ephemeral renders; use upload_template + templateId when you need to reuse the template. ' +
      'Supported formats: DOCX, XLSX, PPTX, ODT, ODS, ODP, ODG, HTML, XHTML, IDML, XML, Markdown (MD), PDF, and more. ' +
      'Mutually exclusive with templateId — provide exactly one, never both.'
    ),

  data: z
    .union([
      z.record(z.string(), z.unknown()),
      z.array(z.unknown()),
      z.string(),
    ])
    .optional()
    .describe(
      'JSON data merged into the template — an object, or a top-level array (accessed with {d[i].field}). ' +
      'Access fields with {d.fieldName} tags. ' +
      'Nested objects: {d.customer.name}. ' +
      'Array loops: {d.items[i].description} … {d.items[i+1]}. ' +
      'Conditionals: {d.status == "active" ? "Yes" : "No"}. ' +
      'Optional: if omitted, {} is sent, so every tag resolves to empty ("Hello {d.name}!" becomes "Hello !"). ' +
      'For a pure conversion that keeps tags as written, use convert_document. ' +
      'Instead of inlining a large dataset, you may pass a STRING reference to the JSON: a local file path ' +
      '(e.g. "/data/invoices.json"), an HTTPS URL, or a base64-encoded JSON string — it is read and parsed ' +
      'server-side. Local paths resolve in stdio (local) mode only; URLs and base64 work in both transports.'
    ),

  convertTo: OutputFormatSchema
    .optional()
    .describe('Output format. If omitted, the output keeps the template format. ' + OUTPUT_FORMAT_DESCRIPTION),

  converter: z
    .enum(CONVERTERS)
    .optional()
    .describe(CONVERTER_DESCRIPTION),

  timezone: z
    .string()
    .optional()
    .describe(
      'IANA timezone used to convert dates in the rendered document. Default: "Europe/Paris". ' +
      'Applied when templates use the :formatD formatter, e.g. {d.date:formatD(YYYY-MM-DD HH:mm)}. ' +
      'Common values: "UTC", "America/New_York", "America/Los_Angeles", "Europe/London", ' +
      '"Europe/Paris", "Europe/Berlin", "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney". ' +
      'Full list (TZ identifier column): https://en.wikipedia.org/wiki/List_of_tz_database_time_zones'
    ),

  lang: z
    .string()
    .optional()
    .describe(
      'Locale of the generated document. Affects three things: ' +
      '(1) {t(key)} translation tags — selects the matching translation from the translations map. ' +
      '(2) :formatN number formatter — applies locale-specific thousand/decimal separators. ' +
      '(3) :formatC currency formatter — applies locale-specific currency symbols and formatting. ' +
      'Format: BCP-47 lowercase, e.g. "fr-fr", "en-us", "de-de", "es-es", "pt-br", "zh-cn", "ja-jp". ' +
      'Full list: https://github.com/carboneio/carbone/blob/master/formatters/_locale.js'
    ),

  complement: z
    .union([z.record(z.string(), z.unknown()), z.string()])
    .optional()
    .describe(
      'Extra data object accessible in templates with {c.field} tags (as opposed to {d.field} for main data). ' +
      'Useful for static or shared values that should not be mixed into the main dataset: ' +
      'company info, logo URLs, footer text, configuration constants. ' +
      'Example: { "company": "Acme Corp", "address": "123 Main St", "vatNumber": "FR12345" }. ' +
      'Like data, may instead be passed by reference as a string — a local path, HTTPS URL, or base64 to a JSON file.'
    ),

  variableStr: z
    .string()
    .optional()
    .describe(
      'Carbone alias expressions evaluated once before rendering, available everywhere in the template. ' +
      'Used to pre-compute reusable values or shorten repetitive paths. ' +
      'Syntax: "{#aliasName = expression}". ' +
      'Example: "{#fullName = d.firstName + \\" \\" + d.lastName}{#total = d.price * d.qty}". ' +
      'Aliases are then used in the template as {#fullName}, {#total}. ' +
      'Documentation: https://carbone.io/documentation/design/substitutions/aliases.html#alias'
    ),

  reportName: z
    .string()
    .optional()
    .describe(
      'Filename (WITHOUT extension) for the generated document, returned in the Content-Disposition header. ' +
      'Carbone automatically appends the extension that matches convertTo, so do not include one — ' +
      'passing "invoice.pdf" yields "invoice.pdf.pdf". ' +
      'Supports Carbone tags resolved against the data at render time. ' +
      'Examples: "invoice" (static), "{d.type}-{d.id}" (dynamic), "{d.client}-{d.date:formatD(YYYY-MM)}".'
    ),

  enum: z
    .union([z.record(z.string(), z.unknown()), z.string()])
    .optional()
    .describe(
      'Enumeration map used with the :convEnum(TYPE) formatter to translate code values into human-readable labels. ' +
      'Define one key per enum type; each value is an object mapping code → label. ' +
      'Example: { "STATUS": { "1": "Active", "2": "Inactive", "3": "Pending" }, "ROLE": { "A": "Admin", "U": "User" } }. ' +
      'Template usage: {d.status:convEnum(STATUS)}, {d.role:convEnum(ROLE)}. ' +
      'May instead be passed by reference as a string — a local path, HTTPS URL, or base64 to a JSON file. ' +
      'Documentation: https://carbone.io/documentation/design/advanced-features/key-value-mapping.html#convenum-type'
    ),

  translations: z
    .union([z.record(z.string(), z.record(z.string(), z.string())), z.string()])
    .optional()
    .describe(
      'Translation map for multilingual documents. Requires "lang" to be set to select the active locale. ' +
      'Top-level keys are BCP-47 locale codes; values are key → translated-string maps. ' +
      'Template usage: {t(greeting)} is replaced by the matching string for the active locale. ' +
      'Example: { "fr-fr": { "greeting": "Bonjour", "total": "Total" }, "en-us": { "greeting": "Hello", "total": "Total" } }. ' +
      'These dictionaries get large, so you may instead pass a string reference — a local path, HTTPS URL, or base64 to a JSON file. ' +
      'Documentation: https://carbone.io/documentation/design/advanced-features/translations-i18n.html'
    ),

  currencySource: z
    .string()
    .optional()
    .describe(
      'ISO 4217 currency code of the monetary amounts in the JSON data. ' +
      'Used by the :formatC formatter as the conversion source. ' +
      'Must be set together with currencyTarget and currencyRates. ' +
      'Example: "EUR" if all prices in your data are in euros.'
    ),

  currencyTarget: z
    .string()
    .optional()
    .describe(
      'ISO 4217 currency code of the output document. ' +
      'The :formatC formatter converts amounts from currencySource to this currency using currencyRates. ' +
      'Must be set together with currencySource and currencyRates. ' +
      'Example: "USD" to display prices in US dollars. ' +
      'Documentation: https://carbone.io/documentation/design/formatters/currency.html#formatc-precisionorformat-targetcurrency'
    ),

  currencyRates: z
    .union([z.record(z.string(), z.number()), z.string()])
    .optional()
    .describe(
      'Exchange rate table used by :formatC for currency conversion. ' +
      'Keys are ISO 4217 currency codes; values are rates relative to a common base. ' +
      'The base currency should have rate 1. ' +
      'Example: { "EUR": 1, "USD": 1.08, "GBP": 0.86, "JPY": 160.5 }. ' +
      'May instead be passed by reference as a string — a local path, HTTPS URL, or base64 to a JSON file.'
    ),

  hardRefresh: z
    .boolean()
    .optional()
    .describe(
      'If true, Carbone recomputes pagination and refreshes the table of contents after rendering. ' +
      'Requires convertTo to be defined. ' +
      'Use this for DOCX/ODT templates that contain a TOC field or cross-references that need updating after data injection.'
    ),

  batchSplitBy: z
    .string()
    .optional()
    .describe(
      'Batch generation: one document per object of an array. ' +
      'Use "d" when data itself is an array, or "d.items" for a direct child array of data. ' +
      'Requires webhookUrl (batch is always asynchronous: the result goes to the webhook, not to this tool). ' +
      'At most 100 objects on Carbone Cloud. Combine with batchOutput and batchReportName. ' +
      'Docs: https://carbone.io/documentation/developer/http-api/generate-reports.html#batch-processing'
    ),

  batchOutput: z
    .enum(['zip', 'pdf'])
    .optional()
    .describe(
      'Batch result type, with batchSplitBy. ' +
      '"zip" (default): an archive of all generated documents. ' +
      '"pdf": the generated PDFs concatenated into one file; requires convertTo "pdf".'
    ),

  batchReportName: z
    .string()
    .optional()
    .describe(
      'Name of each file inside the batch ZIP, WITHOUT extension (Carbone appends it). ' +
      'Carbone tags are resolved against each batch item, e.g. "invoice-{d.id}". ' +
      'Ignored when batchOutput is "pdf". From v5.14, an index is appended to every file ' +
      'as soon as two names collide (invoice_1.pdf, invoice_2.pdf). Requires batchSplitBy.'
    ),

  preReleaseFeatureIn: z
    .number()
    .int()
    .optional()
    .describe(
      'Pre-release feature level for this render only: features and fixes introduced up to this tag apply, ' +
      'later ones stay disabled. Overrides the server default; a tag set in the template overrides it. ' +
      'Example: 5000000. Docs: https://carbone.io/documentation/design/overview/version-lifecycle.html#pre-release-features'
    ),

  failOn: z
    .array(z.enum(['IMAGE_URL_ERROR']))
    .optional()
    .describe(
      'Conditions that stop the render and return an error (Carbone v5.15.0+). ' +
      '"IMAGE_URL_ERROR": an image that cannot be downloaded from its URL fails the render, instead of being ' +
      'replaced with the broken-image placeholder. Empty image values are skipped; base64 images, barcodes and ' +
      'charts are not concerned. Example: ["IMAGE_URL_ERROR"]. ' +
      'Docs: https://carbone.io/documentation/developer/http-api/generate-reports.html#fail-on'
    ),

  webhookUrl: z
    .url()
    .optional()
    .describe(
      'Webhook URL that enables asynchronous rendering (render timeout raised to 5 minutes). ' +
      'This tool then returns only Carbone\'s acceptance message, never the document. ' +
      'When the document is ready, Carbone POSTs { "success": true, "data": { "renderId": "..." } } to this URL; ' +
      'the server behind it must download the document itself with GET /render/{renderId} on the Carbone API ' +
      '(one-time, no auth). You cannot fetch it from here. ' +
      'Required for batchSplitBy: batch output is always delivered this way. ' +
      'outputPath, asAttachment and returnLink are ignored in this mode. ' +
      'Example: "https://your-server.com/carbone-webhook".'
    ),

  webhookHeaders: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Custom headers Carbone will include when POSTing to your webhookUrl. ' +
      'Pass plain header names as keys — the prefix "carbone-webhook-header-" is added automatically before sending to Carbone, ' +
      'and Carbone forwards the original header names to your webhook endpoint. ' +
      'Example: { "authorization": "my-secret", "custom-id": "12345", "custom-name": "Jane Doe" } — ' +
      'Carbone will call your URL with headers: authorization: my-secret, custom-id: 12345, custom-name: Jane Doe. ' +
      'Requires webhookUrl to be set.'
    ),

  egressAuthorization: z
    .string()
    .max(511)
    .optional()
    .describe(
      'Value for the Authorization header Carbone adds to its OUTBOUND (egress) requests while rendering — ' +
      'fetching external images ({d.imageUrl}), external PDFs (:appendFile / :attachFile), and calling webhooks. ' +
      'For example "Bearer abc123" or "my-secret" makes Carbone send `authorization: <value>` to those hosts. ' +
      'Only the authorization header can be customised; max 511 characters. ' +
      'For webhook calls specifically, webhookHeaders.authorization (if set) overrides this value.'
    ),

  outputPath: z
    .string()
    .optional()
    .describe(
      'Optional local file path to save the generated document to (e.g. "/home/user/out.pdf" or "~/out.pdf"). ' +
      'When set, the file is written to disk and the tool returns the saved path + size instead of embedding ' +
      'the document inline — ideal for large files. Local (stdio) mode only; rejected in HTTP mode. ' +
      'Ignored for async/webhook renders (no document is returned inline).'
    ),

  asAttachment: z
    .boolean()
    .optional()
    .describe(
      'If true, return the document as a downloadable file attachment (a base64 EmbeddedResource), for any format. ' +
      'Default delivery: text and png/jpg/gif/webp are returned inline; other binary outputs (PDF, Office, …) are ' +
      'saved to a temp file in stdio mode (path returned), or returned as an attachment in HTTP mode. ' +
      'Ignored when outputPath or returnLink is set.'
    ),

  returnLink: z
    .boolean()
    .optional()
    .describe(
      'If true, generate the document and return a public download URL instead of the file contents. ' +
      'The link is SHORT-LIVED and ONE-TIME — Carbone deletes the file after the first download — so it is ' +
      'meant for the end user to download once (do not fetch it programmatically). Works in stdio and HTTP. ' +
      'Mutually exclusive with outputPath and asAttachment. Ignored when webhookUrl is set (no link is returned).'
    ),
};

export async function handleRenderDocument(
  args: {
    templateId?: string;
    template?: string;
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
    hardRefresh?: boolean;
    batchSplitBy?: string;
    batchOutput?: 'zip' | 'pdf';
    batchReportName?: string;
    preReleaseFeatureIn?: number;
    failOn?: 'IMAGE_URL_ERROR'[];
    webhookUrl?: string;
    webhookHeaders?: Record<string, string>;
    egressAuthorization?: string;
    outputPath?: string;
    asAttachment?: boolean;
    returnLink?: boolean;
  },
  client: CarboneClient,
  options?: CallOptions,
  fileCtx?: FileContext
) {
  // XOR: exactly one of templateId or template must be provided
  if ((args.templateId != null) === (args.template != null)) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'Provide either templateId or template, not both (and not neither).' }],
    };
  }

  try {
    // Gates apply to the template AND every by-reference JSON param (data, complement, …).
    const resolveOpts = {
      isCloud: client.isCloud,
      maxBytes: fileCtx?.maxFileBytes,
      allowLocalPath: fileCtx?.allowFileInput ?? false,
      allowPrivateNetwork: fileCtx?.allowPrivateNetwork ?? false,
    };
    const template = args.template
      ? await resolveFileInput(args.template, resolveOpts)
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

    const result = await client.renderDocument({
      ...args,
      template,
      data: data as object,
      complement: complement as Record<string, unknown> | undefined,
      translations: translations as Record<string, Record<string, string>> | undefined,
      enum: enumMap as Record<string, unknown> | undefined,
      currencyRates: currencyRates as Record<string, number> | undefined,
    }, options);

    return deliver(result, args.convertTo, {
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
