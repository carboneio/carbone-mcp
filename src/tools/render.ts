import { z } from 'zod';
import type { CarboneClient, CallOptions } from '../carbone/client.js';
import { OUTPUT_FORMATS, CONVERTERS } from '../validation/formats.js';
import { resolveFileInput, toToolContent } from '../utils/file.js';
import { saveOrReject, type FileContext } from './output.js';
import { formatError } from '../utils/errors.js';

export const renderDocumentToolName = 'render_document';

export const renderDocumentDescription =
  'Generate a document by merging a Carbone template with JSON data. ' +
  'Two modes: (1) pass templateId to use a previously uploaded template; ' +
  '(2) pass template (file path, URL, or base64) to upload and render in a single request without storing a template. ' +
  'Supports output format conversion, multilingual rendering, currency conversion, ' +
  'batch generation, and advanced PDF options (watermark, password, PDF/A). ' +
  'Async mode: pass webhookUrl to render asynchronously — Carbone will POST the renderId to your URL when the document is ready. ' +
  'Async mode is required when using batch generation (batchSplitBy).';

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
    .record(z.string(), z.unknown())
    .describe(
      'JSON data merged into the template. ' +
      'Access fields with {d.fieldName} tags. ' +
      'Nested objects: {d.customer.name}. ' +
      'Array loops: {d.items[i].description} … {d.items[i+1]}. ' +
      'Conditionals: {d.status == "active" ? "Yes" : "No"}. ' +
      'For pure document conversion without data injection, pass {}.'
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
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Extra data object accessible in templates with {c.field} tags (as opposed to {d.field} for main data). ' +
      'Useful for static or shared values that should not be mixed into the main dataset: ' +
      'company info, logo URLs, footer text, configuration constants. ' +
      'Example: { "company": "Acme Corp", "address": "123 Main St", "vatNumber": "FR12345" }'
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
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Enumeration map used with the :convEnum(TYPE) formatter to translate code values into human-readable labels. ' +
      'Define one key per enum type; each value is an object mapping code → label. ' +
      'Example: { "STATUS": { "1": "Active", "2": "Inactive", "3": "Pending" }, "ROLE": { "A": "Admin", "U": "User" } }. ' +
      'Template usage: {d.status:convEnum(STATUS)}, {d.role:convEnum(ROLE)}. ' +
      'Documentation: https://carbone.io/documentation.html#convenum-type-'
    ),

  translations: z
    .record(z.string(), z.record(z.string(), z.string()))
    .optional()
    .describe(
      'Translation map for multilingual documents. Requires "lang" to be set to select the active locale. ' +
      'Top-level keys are BCP-47 locale codes; values are key → translated-string maps. ' +
      'Template usage: {t(greeting)} is replaced by the matching string for the active locale. ' +
      'Example: { "fr-fr": { "greeting": "Bonjour", "total": "Total" }, "en-us": { "greeting": "Hello", "total": "Total" } }. ' +
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
    .record(z.string(), z.number())
    .optional()
    .describe(
      'Exchange rate table used by :formatC for currency conversion. ' +
      'Keys are ISO 4217 currency codes; values are rates relative to a common base. ' +
      'The base currency should have rate 1. ' +
      'Example: { "EUR": 1, "USD": 1.08, "GBP": 0.86, "JPY": 160.5 }.'
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
      'One document is generated per element of the array; all documents are bundled together. ' +
      'Use batchOutput: "zip" to receive a single ZIP archive. ' +
      'Use batchReportName to customise each filename inside the ZIP. ' +
      'Example: "d.invoices" — produces one PDF per item in data.invoices. ' +
      'Example: "d.employees" — produces one contract per employee.'
    ),

  batchOutput: z
    .string()
    .optional()
    .describe(
      'Container format for the batch result. ' +
      'Use "zip" to receive all generated documents as a single ZIP archive. ' +
      'Must be used together with batchSplitBy.'
    ),

  batchReportName: z
    .string()
    .optional()
    .describe(
      'Filename pattern for each individual document inside the batch ZIP. Supports Carbone tags. ' +
      'Tags are resolved against the item\'s data (relative path) or the full dataset (absolute path). ' +
      'Examples: "invoice-{d.id}.pdf", "{d.client.name}-{d.date}.docx". ' +
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
      'If true, return the document as a downloadable file attachment (base64 resource) instead of inline ' +
      'text/image. Use when the user wants to download or save the file rather than read its content inline — ' +
      'especially in HTTP mode where outputPath is unavailable. Default: false (text inline, images viewable, ' +
      'other binaries as resources). Ignored when outputPath is set.'
    ),
};

export async function handleRenderDocument(
  args: {
    templateId?: string;
    template?: string;
    data: Record<string, unknown>;
    convertTo?: z.infer<typeof renderDocumentSchema.convertTo>;
    converter?: string;
    timezone?: string;
    lang?: string;
    complement?: Record<string, unknown>;
    variableStr?: string;
    reportName?: string;
    enum?: Record<string, unknown>;
    translations?: Record<string, Record<string, string>>;
    currencySource?: string;
    currencyTarget?: string;
    currencyRates?: Record<string, number>;
    hardRefresh?: boolean;
    batchSplitBy?: string;
    batchOutput?: string;
    batchReportName?: string;
    webhookUrl?: string;
    webhookHeaders?: Record<string, string>;
    outputPath?: string;
    asAttachment?: boolean;
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
    const template = args.template
      ? await resolveFileInput(args.template, { isCloud: client.isCloud, maxBytes: fileCtx?.maxFileBytes })
      : undefined;
    const result = await client.renderDocument({ ...args, template }, options);

    if ('async' in result) {
      return { content: [{ type: 'text' as const, text: result.message }] };
    }

    const format = args.convertTo ?? result.filename.split('.').pop() ?? 'pdf';

    if (args.outputPath) {
      return saveOrReject({ buffer: result.buffer, format, outputPath: args.outputPath, allowFileOutput: fileCtx?.allowFileOutput ?? false });
    }

    const content = toToolContent(result.buffer, result.filename, format, args.asAttachment);
    return { content: [content] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: formatError(error) }],
    };
  }
}
