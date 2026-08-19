import { z } from 'zod';
import type { CarboneClient, CallOptions } from '../carbone/client.js';
import { OUTPUT_FORMATS, CONVERTERS } from '../validation/formats.js';
import { resolveFileInput, resolveJsonInput } from '../utils/file.js';
import { deliver, type FileContext } from './output.js';
import { formatError } from '../utils/errors.js';
import { type IoModes, STDIO_IO, inputForms, jsonRefForms, outputPathDescription } from './inputForms.js';

export const renderDocumentToolName = 'render_document';

export const renderDocumentDescription =
  'Generate a document by merging a Carbone template with JSON data. ' +
  'Two modes: (1) pass templateId to use a previously uploaded template; ' +
  '(2) pass template (file path, URL, or base64) to upload and render in a single request without storing a template. ' +
  'Supports output format conversion, multilingual rendering, currency conversion, ' +
  'batch generation, and advanced PDF options (watermark, password, PDF/A). ' +
  'Async mode: pass webhookUrl to render asynchronously — Carbone will POST the renderId to your URL when the document is ready. ' +
  'Async mode is required when using batch generation (batchSplitBy).';

export function renderDocumentSchemaFor(io: IoModes) {
  return {
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
        'Inline template for one-shot render without storing a template first. ' + inputForms(io) +
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
        'Optional — if omitted, defaults to an empty object {} so the template is simply converted ' +
        '(tags resolve to empty). Useful to convert a stored template by templateId without data injection. ' +
        'Instead of inlining a large dataset, you may pass a STRING reference to the JSON: ' +
        jsonRefForms(io) + ' — it is read and parsed server-side.'
      ),

    convertTo: z
      .union([
        z.enum(OUTPUT_FORMATS),
        z.object({
          formatName: z.enum(OUTPUT_FORMATS).describe('Target format name.'),
          formatOptions: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              'Advanced format options object. Examples by format: ' +
              'PDF — { "EncryptFile": true, "DocumentOpenPassword": "secret", "DocumentPermissionPassword": "owner" } password-protect; ' +
              'PDF — { "Watermarks": [{ "text": "DRAFT", "opacity": 0.2, "rotation": -45, "fontsize": 60 }] } up to 5 watermarks; ' +
              'PDF — { "SelectPdfVersion": 1 } PDF/A-1b compliance (use 2 for PDF/A-2, 3 for PDF/A-3); ' +
              'PDF — { "PageRange": "1-3,5" } export specific pages only; ' +
              'PDF — { "ConvertSlideshow": true } convert each slide to a separate PDF page; ' +
              'Images (PNG/JPG/WEBP) — { "Quality": 90 } compression quality 0-100; ' +
              'Images — { "density": 150 } DPI for rasterisation (default 96); ' +
              'CSV — { "fieldSeparator": ";" } custom column separator.'
            ),
        }),
      ])
      .optional()
      .describe(
        'Output format. If omitted, the output matches the template format. ' +
        'Documents : "pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "odg", "rtf", "epub". ' +
        'Web/text  : "html", "xhtml", "txt", "csv", "md", "xml", "idml". ' +
        'Images    : "png", "jpg", "jpeg", "webp", "svg", "tiff", "bmp", "gif". ' +
        'Archive   : "zip" (use with batchSplitBy for batch output). ' +
        'Simple usage: "pdf". ' +
        'Advanced usage: { "formatName": "pdf", "formatOptions": { ... } } for PDF-specific options.'
      ),

    converter: z
      .enum(CONVERTERS)
      .optional()
      .describe(
        'Converter engine. Only relevant when convertTo is "pdf" (or an image rasterised from a document). ' +
        '"L" — LibreOffice (default): best all-round engine for DOCX, XLSX, PPTX, ODT, ODS, ODP. ' +
        '"O" — OnlyOffice: highest fidelity for Microsoft Office formats (DOCX, XLSX, PPTX). ' +
        '"C" — Chromium: best for HTML/CSS/JS templates — full browser rendering. ' +
        '"I" — Carbone ICE (Instant Converter Engine, Carbone 5.14.0+): DOCX → PDF ONLY, no third-party converter — ' +
        'up to 60x faster than LibreOffice on a 1000-page DOCX (3x on a one-page document). ' +
        'Any other input or output format is REJECTED — use another converter for those. ' +
        'PDF options: only Watermarks are applied. EncryptFile, DocumentOpenPassword, RestrictPermissions and the ' +
        'other security options are SILENTLY IGNORED — the PDF comes back readable by anyone, with no error — ' +
        'so NEVER pick "I" when the request needs a password or restricted permissions; use "L" for those. ' +
        'Also unsupported: WEBP and EMF/WMF images, table of contents, SmartArt, complex charts, footnotes/endnotes, ' +
        'comments, tracked changes, form fields, equations, bookmarks and links; a missing font falls back to Noto Sans. ' +
        'If omitted, LibreOffice is used by default.'
      ),

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
        'Like data, may instead be passed by reference as a string — ' + jsonRefForms(io) + '.'
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
        'Documentation: https://carbone.io/documentation.html#alias'
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
        'May instead be passed by reference as a string — ' + jsonRefForms(io) + '. ' +
        'Documentation: https://carbone.io/documentation.html#convenum-type-'
      ),

    translations: z
      .union([z.record(z.string(), z.record(z.string(), z.string())), z.string()])
      .optional()
      .describe(
        'Translation map for multilingual documents. Requires "lang" to be set to select the active locale. ' +
        'Top-level keys are BCP-47 locale codes; values are key → translated-string maps. ' +
        'Template usage: {t(greeting)} is replaced by the matching string for the active locale. ' +
        'Example: { "fr-fr": { "greeting": "Bonjour", "total": "Total" }, "en-us": { "greeting": "Hello", "total": "Total" } }. ' +
        'These dictionaries get large, so you may instead pass a string reference — ' + jsonRefForms(io) + '. ' +
        'Documentation: https://carbone.io/documentation.html#translations'
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
        'Documentation: https://carbone.io/documentation.html#formatc-precisionorformat-'
      ),

    currencyRates: z
      .union([z.record(z.string(), z.number()), z.string()])
      .optional()
      .describe(
        'Exchange rate table used by :formatC for currency conversion. ' +
        'Keys are ISO 4217 currency codes; values are rates relative to a common base. ' +
        'The base currency should have rate 1. ' +
        'Example: { "EUR": 1, "USD": 1.08, "GBP": 0.86, "JPY": 160.5 }. ' +
        'May instead be passed by reference as a string — ' + jsonRefForms(io) + '.'
      ),

    keepTags: z
      .boolean()
      .optional()
      .describe(
        'If true, SKIP templating entirely and leave every Carbone tag in the document exactly as written — ' +
        '{d.customer} comes out as the literal text "{d.customer}", formatters included. ' +
        'Use it to proof a stored template in another format (e.g. render templateId to PDF to check the tag ' +
        'layout), or to convert a template between formats while it stays a template. ' +
        'Mutually exclusive with data — passing both is rejected, because data would have nothing to fill. ' +
        'Note the difference from omitting data: no data renders the template with an EMPTY dataset, so every ' +
        'tag resolves to an empty string; keepTags leaves the tags themselves in place. ' +
        'Requires Carbone 5.9.0+ (carbone-version: 5).'
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
        'JSON path to the array in your data that drives batch generation. ' +
        'One document is generated per element of the array. ' +
        'Two forms: "d" when data itself IS the array (one report per top-level element), or "d.arrayName" ' +
        'to split on a child array. ' +
        'Example: "d.invoices" — produces one PDF per item in data.invoices. ' +
        'Example: "d.employees" — produces one contract per employee. ' +
        'Carbone Cloud allows 1 to 100 objects per batch (on-premise follows the nbReportMaxPerBatch setting). ' +
        'Batch is ALWAYS asynchronous — webhookUrl is required. ' +
        'Pair with batchOutput to choose ZIP or a single concatenated PDF, and batchReportName to name each document.'
      ),

    batchOutput: z
      .enum(['zip', 'pdf'])
      .optional()
      .describe(
        'How the batch result is packaged. Defaults to "zip". ' +
        '"zip" — every generated document is bundled into a single ZIP archive (use batchReportName to name each entry). ' +
        '"pdf" — all documents are CONCATENATED into one continuous PDF instead of being zipped; ' +
        'this requires convertTo to be "pdf" as well. ' +
        'Must be used together with batchSplitBy.'
      ),

    batchReportName: z
      .string()
      .optional()
      .describe(
        'Filename pattern for each individual document inside the batch ZIP. Supports Carbone tags. ' +
        'Tags are resolved against the item\'s data (relative path) or the full dataset (absolute path). ' +
        'Examples: "invoice-{d.id}.pdf", "{d.client.name}-{d.date}.docx". ' +
        'Carbone sanitises the result — path separators, "..", Windows-forbidden and control characters ' +
        'each become an underscore — and appends an index to duplicates ("report_1.pdf", "report_2.pdf"), ' +
        'so a pattern that resolves to the same name for several items will not silently drop documents. ' +
        'Only meaningful with batchOutput: "zip"; a concatenated "pdf" batch is a single file. ' +
        'Must be used together with batchSplitBy.'
      ),

    webhookUrl: z
      .url()
      .optional()
      .describe(
        'Webhook URL to enable asynchronous rendering. ' +
        'When provided, Carbone returns immediately and POSTs { "success": true, "data": { "renderId": "..." } } to this URL when the document is ready. ' +
        'The default render timeout is extended to 5 minutes on Carbone Cloud (vs 60 s for synchronous requests). ' +
        'Download the document with GET /render/:renderId once the webhook is received. ' +
        'Required when using batchSplitBy (batch generation is always asynchronous). ' +
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
      .max(512)
      .optional()
      .describe(
        'Value for the Authorization header Carbone adds to its OUTBOUND (egress) requests while rendering — ' +
        'fetching external images ({d.imageUrl}), external PDFs (:appendFile / :attachFile), and calling webhooks. ' +
        'For example "Bearer abc123" or "my-secret" makes Carbone send `authorization: <value>` to those hosts. ' +
        'Only the authorization header can be customised; max 512 characters. ' +
        'For webhook calls specifically, webhookHeaders.authorization (if set) overrides this value.'
      ),

    outputPath: z
      .string()
      .optional()
      .describe(
        outputPathDescription('generated document', io) +
        ' Ignored for async/webhook renders (no document is returned inline).'
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
        'Mutually exclusive with outputPath, asAttachment, and webhookUrl (async).'
      ),
  };
}

/** Default (stdio) wording — also the shape the validation schemas derive from. */
export const renderDocumentSchema = renderDocumentSchemaFor(STDIO_IO);

export async function handleRenderDocument(
  args: {
    templateId?: string;
    template?: string;
    data?: Record<string, unknown> | unknown[] | string;
    convertTo?: z.infer<typeof renderDocumentSchema.convertTo>;
    converter?: string;
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

  // Documented batch constraint: concatenating into one PDF requires the documents to BE PDFs.
  if (args.batchOutput === 'pdf' && args.convertTo !== 'pdf'
      && !(typeof args.convertTo === 'object' && args.convertTo?.formatName === 'pdf')) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'batchOutput:"pdf" concatenates the batch into one PDF, so convertTo must be "pdf" too. Use batchOutput:"zip" to bundle other formats.' }],
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
