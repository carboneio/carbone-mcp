import { z } from 'zod';
import type { CarboneClient, CallOptions } from '../carbone/client.js';
import { formatError } from '../utils/errors.js';
import { INPUT_FORMATS, OUTPUT_FORMATS } from '../validation/formats.js';
import { type IoModes, inputFormsShort, jsonRefForms } from './inputForms.js';

// ─── get_api_status ───────────────────────────────────────────────────────────

export const getApiStatusToolName = 'get_api_status';

export const getApiStatusDescription =
  'Check Carbone API health and version. Returns the current API version and a status message. ' +
  'Useful for verifying connectivity and confirming which Carbone version is active.';

export const getApiStatusSchema = {};

export const getApiStatusOutputSchema = {
  version: z.string().describe('The running Carbone API version.'),
  message: z.string().describe('Status message returned by the API.'),
};

export async function handleGetApiStatus(client: CarboneClient, options?: CallOptions) {
  try {
    const status = await client.getStatus(options);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Carbone API: online (v${status.version})\nMessage: ${status.message}`,
        },
      ],
      structuredContent: { version: status.version, message: status.message },
    };
  } catch (error) {
    return { content: [{ type: 'text' as const, text: formatError(error) }], isError: true };
  }
}

// ─── get_capabilities ─────────────────────────────────────────────────────────

export const getCapabilitiesToolName = 'get_capabilities';

export const getCapabilitiesDescription =
  'Returns a summary of all Carbone capabilities: supported formats, features, tool usage examples, ' +
  'and links to full documentation. Call this first if you are unsure what Carbone can do.';

export const getCapabilitiesSchema = {};

const capabilitiesText = (io: IoModes) => `# Carbone — Document Generation & Conversion

## Tools available

| Tool                       | Purpose                                                  |
|----------------------------|----------------------------------------------------------|
| convert_document           | Convert a document to another format (tags kept as is)   |
| render_document            | Generate a document from a template + JSON data          |
| inspect_template           | List a template's tags and get a matching sample dataset |
| list_templates             | List stored templates (filter by category, search, limit)|
| list_categories            | List all template categories in your account             |
| list_tags                  | List all tags used across your templates                 |
| upload_template            | Upload and store a reusable template                     |
| update_template_metadata   | Rename, re-categorise, deploy, or expire a template      |
| delete_template            | Delete a template (takes effect immediately)             |
| download_template          | Download the original template file                      |
| get_api_status             | Check Carbone API health and current version             |
| get_capabilities           | This overview                                            |

## Resources available

| Resource                | Purpose                                          |
|-------------------------|--------------------------------------------------|
| carbone://templates     | Browse all stored templates                      |
| carbone://templates/{id}| Fetch one template (with version history) by ID  |
| carbone://categories    | List all template categories                     |
| carbone://tags          | List all template tags                           |
| carbone://status        | Check Carbone API health and version             |

---

## Common Use Cases

Invoice, Quote/Proposal, Purchase order, Pay slip, Delivery note, Offer letter, Employment contract, Certificate (completion/training), Monthly/quarterly report, Product catalog, Lab/medical report, Subscription receipt, Marketing brochure, Terms of service, Privacy policy, Newsletter, Company presentation

---

## 1. Document Conversion (no template needed)

Use \`convert_document\` for a pure conversion: no data is sent, so Carbone tags such as \`{d.name}\` are kept as written (use \`render_document\` to fill them). That makes it the way to proof a template in another format (DOCX template → PDF), or to convert a template while it stays a template (DOCX → ODT). \`render_document\` can also skip templating with \`keepTags: true\`, to proof a STORED template by \`templateId\`.

**Accepted file input:** ${inputFormsShort(io)}. Rendering and conversion accept the same input formats: ${INPUT_FORMATS.join(', ')}. The legacy binary formats DOC, XLS and PPT are rejected as input (re-save them as DOCX/XLSX/PPTX), although Carbone can produce them.

**Common conversions** (valid outputs depend on the input format):
- DOCX / XLSX / PPTX / ODT / ODS / ODP / ODG → PDF
- HTML → PDF, PNG, JPG, WEBP       (converter "C" for full CSS/JS rendering)
- DOCX ↔ ODT, XLSX ↔ CSV ↔ ODS, PPTX ↔ ODP
- DOCX / ODT → HTML, MD
- DOCX / PPTX / XLSX → PNG, JPG, TIFF, SVG, WEBP
- Markdown → PDF, DOCX, ODT, PNG, JPG
- PDF → DOCX, ODT, HTML, TXT, or PNG, JPG, WEBP; PDF → PDF to add a password, watermarks or PDF/A

**Converter engines** (\`converter\`, used whenever the format changes, not only for PDF):
- \`L\` LibreOffice (default): DOCX, XLSX, PPTX, ODT, ODS, ODP, ODG, MD, PDF; the only converter supporting all PDF options
- \`I\` Carbone ICE: DOCX and ODT → PDF; Carbone's own engine, 3x to 300x faster, recommended over \`O\` for DOCX from v5.15.0. It converts all content except WEBP and EMF/WMF images, SmartArt and complex charts (bar, line, area, pie and doughnut charts are drawn), comments, tracked changes, form fields and equations: keep the default \`L\` for documents with those. A missing font is replaced by Noto Sans (https://carbone.io/documentation/developer/http-api/generate-reports.md#converters-carbone-ice-limitations)
- \`O\` OnlyOffice: DOCX, XLSX, PPTX → PDF
- \`C\` Chromium: HTML → PDF, JPG, PNG, WEBP with full CSS/JS; 100 MB max
- PDF options: \`L\` supports all of them; \`O\`, \`C\` and \`I\` apply Security (passwords, permissions) and Watermarks.

**Format options** (\`convertTo: { "formatName": "pdf", "formatOptions": { … } }\`):
- Password: \`{ "EncryptFile": true, "DocumentOpenPassword": "s3cr3t" }\`
- Permissions: \`{ "RestrictPermissions": true, "PermissionPassword": "owner" }\`
- Watermarks (max 4): \`{ "Watermarks": [{ "text": "CONFIDENTIAL", "size": 60, "opacity": 0.1, "rotation": -45 }] }\`
- PDF/A (L only): \`{ "SelectPdfVersion": 2 }\` (2 = PDF/A-2b, 3 = PDF/A-3b, 4 = PDF/A-4); pages (L only): \`{ "PageRange": "1-5" }\`
- Accessibility (L only): \`{ "UseTaggedPDF": true, "PDFUACompliance": true }\`
- JPG/PNG: \`{ "PixelWidth": 1200, "PixelHeight": 630 }\`, JPG quality \`{ "Quality": 80 }\` (1-100); CSV: \`{ "fieldSeparator": ";" }\`

Full conversion matrix: https://carbone.io/documentation/developer/http-api/generate-reports.md

---

## 2. Template-Based Generation

> **Authoring from scratch?** LLMs can write HTML documents or templates directly:
> - **HTML or Markdown with Carbone tags** → use as a template with \`render_document\`. The Carbone Skill (see Documentation) is a reference for the Universal Carbone Templating syntax; validate all tag structures before rendering.
> - **Plain HTML or Markdown (no Carbone tags)** → static document, use \`convert_document\` to produce PDF, DOCX, etc.
> - **DOCX / XLSX / PPTX editing** → if the LLM supports editing Office files, Carbone tags can be injected directly into existing DOCX, XLSX, or PPTX files to create or update templates. The same Carbone tag syntax applies.

Two modes — choose based on whether you need to reuse the template:

**Mode A — Stored template (reusable):**
1. Design a template in Word / Excel / PowerPoint / LibreOffice / HTML / Markdown with \`{d.field}\` tags
2. Upload it with \`upload_template\` → get a Template ID
3. Call \`render_document\` with \`templateId\`, your JSON data, and \`convertTo\` (e.g. \`"pdf"\`)

**Mode B — Inline template (one-shot, no storage):**
1. Call \`render_document\` with \`template\` (${inputFormsShort(io)}), your JSON data, and \`convertTo\`
2. The template is uploaded and rendered in a single request — no Template ID is returned

**Output format:** \`convertTo\` controls the generated file format (e.g. \`"pdf"\`, \`"docx"\`, \`"xlsx"\`, \`"html"\`). Defaults to the template's own format if omitted.

**Passing data:** \`data\` is an inline JSON object — or a top-level array (\`{d[i].field}\`). It is optional: without it, {} is sent and every tag resolves to empty (to keep the tags as written, pass \`keepTags: true\` without data, or use \`convert_document\` for a file). \`data\` (and \`complement\`, \`translations\`, \`enum\`, \`currencyRates\`) may also be passed by reference as a STRING: ${jsonRefForms(io)} — read and parsed server-side. Prefer a reference for large datasets to keep them out of the tool call.

**External resources behind auth:** if a template fetches a protected external image/PDF, or you call a secured webhook, pass \`egressAuthorization\` (e.g. "Bearer abc123", max 511 chars) — Carbone sends it as the \`authorization\` header on those outbound requests. Also available on convert_document (for HTML→PDF assets). For webhooks, webhookHeaders.authorization overrides it.

**Template data tags (quick reference):**
- \`{d.customer.name}\`            — simple field access
- \`{c.company}\`                  — complement data (static/shared values passed via \`complement\`)
- \`{d.price:formatC()}\`          — currency, formatted per \`lang\`; converted from \`currencySource\` to \`currencyTarget\` when set
- \`{d.date:formatD(YYYY-MM-DD)}\` — date formatter
- \`{d.items[i].description}\`     — array loop start
- \`{d.items[i+1]}\`               — array loop end
- \`{t(label)}\`                     — translation tag (requires \`lang\` + \`translations\`)
- \`{d.status:ifEQ(active):show(Yes):elseShow(No)}\` — conditional (inline value)
- \`{d.toBuy:ifEQ(true):showBegin}\` … \`{d.toBuy:showEnd}\` — conditional block

> The full syntax reference (all formatters, conditions, loops and translations) is in the Carbone Skill and the documentation below.

**Fail fast and feature level:** \`failOn: ["IMAGE_URL_ERROR"]\` (v5.15.0+) stops the render when an image cannot be downloaded from its URL, instead of showing a broken-image placeholder. \`preReleaseFeatureIn\` (integer, e.g. 5000000) sets the pre-release feature level for one render.

**Async rendering** (\`webhookUrl\`):
- Pass a \`webhookUrl\` in the \`render_document\` call to render asynchronously (timeout: **5 minutes**, vs 1 minute for synchronous).
- The tool then returns only Carbone's acceptance message, never the document. When done, Carbone POSTs \`{ "success": true, "data": { "renderId": "…" } }\` to the webhook, and the server behind it downloads the document itself with \`GET /render/{renderId}\` (one-time, no auth). You cannot fetch it from here.

**Batch generation** (one document per array item, at most 100 items on Carbone Cloud):
- **Batch rendering is always asynchronous**: \`webhookUrl\` is required, and the result is delivered as above.
- \`batchSplitBy\`: \`"d"\` when \`data\` itself is an array, or \`"d.items"\` for a direct child array.
- \`batchOutput\`: \`"zip"\` (default, one archive) or \`"pdf"\` (all PDFs concatenated; requires \`convertTo: "pdf"\`).
- \`batchReportName\`: name of each file in the ZIP, WITHOUT extension (e.g. \`"invoice-{d.id}"\`); ignored with \`batchOutput: "pdf"\`.

**PDF form filling:**
- Use a PDF with fillable form fields as the template
- Pass field values in \`data\` — Carbone maps them to the PDF form fields automatically

---

## 3. Supported Output Formats (\`convertTo\`)

${OUTPUT_FORMATS.join(', ')}

Valid outputs depend on the input format: see the conversion matrix above. \`doc\`, \`xls\` and \`ppt\` are output-only.

---

## 4. Stored Templates

- \`upload_template\`: only \`template\` is required; give it a \`name\` (list_templates shows and searches it). A result \`deployedAt\` of 0 means the version is not explicitly deployed: if another version of the same Template ID is deployed, renders by Template ID keep using that one.
- Rendering by Template ID uses the version with the most recent \`deployedAt\`. To deploy a version, call \`update_template_metadata\` with templateId = its Version ID and deployedAt = 42000000000 (now).
- \`update_template_metadata\` with a Template ID patches only its currently deployed version; with a Version ID, that exact version.
- Deletion: \`delete_template\` takes effect immediately (no longer listed, downloadable or renderable). \`expireAt\` schedules a deletion at a Unix timestamp instead; 0 means never (on update, 0 cancels a scheduled deletion).
- \`download_template\` with \`sample: true\` returns the JSON sample data stored with a template.

---

## Documentation

All Carbone docs are LLM-friendly: replace \`.html\` with \`.md\` on any documentation URL for the Markdown
version; the whole corpus is also in the llms.txt files below.
- llms.txt (doc index):  https://carbone.io/llms.txt
- llms-full.txt (full):  https://carbone.io/llms-full.txt
- API reference:         https://carbone.io/documentation/developer/http-api/introduction.md
- OpenAPI spec:          https://carbone.io/file/carbone.OpenAPI.yml
- Template tags syntax:  https://carbone.io/documentation/design/overview/getting-started.md
- HTML templates guide:  https://carbone.io/documentation/design/template-formats/html.md
- Markdown templates:    https://carbone.io/documentation/design/template-formats/markdown.md
- MCP server docs:       https://carbone.io/documentation/developer/ai/mcp.md
- Changelog:             https://carbone.io/changelog.md

**Carbone Skill:**
A reference of Carbone's templating syntax, formatters and template design guidance for AI assistants,
in the Agent Skills format (agentskills.io):
- Skill file (ZIP):     https://github.com/carboneio/carbone-agent-plugin/releases/latest/download/carbone.skill
- Skill documentation:  https://carbone.io/documentation/developer/ai/skills.md
- GitHub repository:    https://github.com/carboneio/carbone-agent-plugin
`;

export function handleGetCapabilities(io: IoModes) {
  return {
    content: [{ type: 'text' as const, text: capabilitiesText(io) }],
  };
}
