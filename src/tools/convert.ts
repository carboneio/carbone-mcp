import { extname } from 'node:path';
import { z } from 'zod';
import type { CarboneClient, CallOptions } from '../carbone/client.js';
import { OUTPUT_FORMATS, CONVERTERS } from '../validation/formats.js';
import { resolveFileInput } from '../utils/file.js';
import { deliver, type FileContext } from './output.js';
import { formatError } from '../utils/errors.js';
import { type IoModes, STDIO_IO, inputForms, jsonRefForms, outputPathDescription } from './inputForms.js';

export const convertDocumentToolName = 'convert_document';

export const convertDocumentDescription =
  'Convert any document to another format without storing a template. ' +
  'Supports 100+ input/output format combinations: Office documents, PDFs, images, web pages, spreadsheets, and more. ' +
  'The source file can be a local path, a URL, or a base64 string. ' +
  'Carbone tags are PRESERVED, not resolved: converting a template keeps every {d.field} intact, so this is also ' +
  'how you proof a template in another format (DOCX template → PDF, or DOCX → ODT while it stays a template). ' +
  'Use render_document instead when you need data injection ({d.field} tags resolved), translations, or batch generation. ' +
  'Common conversions: ' +
  'DOCX → PDF (file: "report.docx", convertTo: "pdf"; add converter: "I" for the fastest DOCX→PDF path), ' +
  'XLSX → PDF (file: "data.xlsx", convertTo: "pdf"), ' +
  'PPTX → PDF (file: "slides.pptx", convertTo: "pdf", converter: "O" for best fidelity), ' +
  'HTML → PDF (file: "page.html", convertTo: "pdf", converter: "C" for full CSS/JS rendering), ' +
  'DOCX → HTML (file: "doc.docx", convertTo: "html"), ' +
  'XLSX → CSV (file: "sheet.xlsx", convertTo: "csv"), ' +
  'PDF → PNG (file: "doc.pdf", convertTo: "png"), ' +
  'PPTX → PNG (first slide as image), ' +
  'MD → PDF (file: "readme.md", convertTo: "pdf").';

export function convertDocumentSchemaFor(io: IoModes) {
  return {
    file: z
      .string()
      .min(1)
      .describe(
        'The document to convert. ' + inputForms(io) +
        'Supported input formats: DOCX, XLSX, PPTX, ODT, ODS, ODP, ODG, HTML, XHTML, XML, SVG, IDML, ' +
        'Markdown (MD), TXT, CSV, RTF, PDF, PNG and JPG. ' +
        'Carbone reads XML-based and text-based documents only, so the legacy BINARY Office formats ' +
        'DOC, XLS and PPT are REJECTED as input — Carbone can produce them as output but cannot read them. ' +
        'Re-save such a file as DOCX/XLSX/PPTX first. ' +
        'Full conversion matrix: https://carbone.io/documentation/developer/http-api/generate-reports.md'
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
              'Images (PNG/JPG/WEBP) — { "Quality": 90 } set compression quality 0-100; ' +
              'Images — { "density": 150 } set DPI for rasterisation (default 96); ' +
              'CSV — { "fieldSeparator": ";" } custom column separator.'
            ),
        }),
      ])
      .describe(
        'Target output format. ' +
        'Documents : "pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "odg", "rtf", "epub", ' +
        'plus the legacy "doc", "xls", "ppt" (output only — Carbone writes them but cannot read them back). ' +
        'Web/text  : "html", "xhtml", "txt", "csv", "md", "xml", "idml". ' +
        'Images    : "png", "jpg", "jpeg", "webp", "svg", "tiff", "bmp", "gif". ' +
        'Archive   : "zip" (batch output). ' +
        'Simple usage: "pdf". ' +
        'Advanced usage: { "formatName": "pdf", "formatOptions": { "EncryptFile": true, "DocumentOpenPassword": "secret" } }.'
      ),

    converter: z
      .enum(CONVERTERS)
      .optional()
      .describe(
        'Converter engine. Only relevant when convertTo is "pdf" (or an image format rasterised from a document). ' +
        '"L" — LibreOffice (default): best all-round engine for DOCX, XLSX, PPTX, ODT, ODS, ODP. ' +
        '"O" — OnlyOffice: highest fidelity rendering for Microsoft Office formats (DOCX, XLSX, PPTX). ' +
        '"C" — Chromium: best for HTML, CSS, JavaScript — full browser rendering. ' +
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

    reportName: z
      .string()
      .optional()
      .describe(
        'Filename (WITHOUT extension) for the converted document, returned in the Content-Disposition header. ' +
        'Carbone appends the extension matching convertTo, so do not include one — "report.pdf" yields "report.pdf.pdf". ' +
        'Examples: "contract", "2026-invoice". ' +
        'Unlike render_document, Carbone tags are NOT resolved here (conversion does not run templating), ' +
        'so pass a literal name rather than a pattern like "{d.id}" — a pattern would come back verbatim. ' +
        'Ignored when returnLink is set, which returns a download URL rather than a named file.'
      ),

    hardRefresh: z
      .boolean()
      .optional()
      .describe(
        'Forces Carbone to run the converter even when the output format already matches the input format. ' +
        'Only useful for PDF: converting PDF → PDF to APPLY formatOptions (watermark, password, PDF/A, page range). ' +
        'Without it Carbone may pass the file straight through and none of those options take effect. ' +
        'Leave unset for any format-changing conversion (DOCX → PDF, XLSX → CSV, …), where the converter runs anyway.'
      ),

    outputPath: z
      .string()
      .optional()
      .describe(
        outputPathDescription('converted document', io)
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
        'Mutually exclusive with outputPath and asAttachment.'
      ),

    egressAuthorization: z
      .string()
      .max(512)
      .optional()
      .describe(
        'Value for the Authorization header Carbone adds to its OUTBOUND (egress) requests during conversion — ' +
        'e.g. when a Chromium HTML→PDF conversion fetches a protected external image or stylesheet. ' +
        'For example "Bearer abc123" makes Carbone send `authorization: Bearer abc123` to those hosts. ' +
        'Only the authorization header can be customised; max 512 characters.'
      ),
  };
}

/** Default (stdio) wording — also the shape the validation schemas derive from. */
export const convertDocumentSchema = convertDocumentSchemaFor(STDIO_IO);

export async function handleConvertDocument(
  args: { file: string; convertTo: z.infer<typeof convertDocumentSchema.convertTo>; converter?: 'L' | 'C' | 'O' | 'I'; reportName?: string; hardRefresh?: boolean; outputPath?: string; asAttachment?: boolean; returnLink?: boolean; egressAuthorization?: string },
  client: CarboneClient,
  options?: CallOptions,
  fileCtx?: FileContext
) {
  try {
    // rest carries convertTo, converter, reportName, hardRefresh, egressAuthorization straight through.
    const { file, outputPath, asAttachment, returnLink, ...rest } = args;
    const template = await resolveFileInput(file, {
      isCloud: client.isCloud,
      maxBytes: fileCtx?.maxFileBytes,
      allowLocalPath: fileCtx?.allowFileInput ?? false,
      allowPrivateNetwork: fileCtx?.allowPrivateNetwork ?? false,
    });
    const result = await client.convertDocument({ ...rest, template, returnLink }, options);

    // Carbone resolves reportName during the templating pass, and conversion deliberately skips that
    // pass (this is what keeps the tags intact), so the API falls back to "report.<ext>". reportName is
    // a literal string here — no tags to resolve — so applying it locally gives the caller exactly what
    // they asked for. Not applicable to returnLink, which returns a renderId rather than bytes.
    const named = args.reportName && 'filename' in result
      ? { ...result, filename: args.reportName + extname(result.filename) }
      : result;

    return deliver(named, args.convertTo, {
      outputPath, asAttachment, allowFileOutput: fileCtx?.allowFileOutput ?? false,
      renderUrl: (id) => client.renderUrl(id),
    });
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: formatError(error) }],
    };
  }
}
