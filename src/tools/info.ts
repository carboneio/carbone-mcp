import { z } from 'zod';
import type { CarboneClient, CallOptions } from '../carbone/client.js';
import { formatError } from '../utils/errors.js';

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

const CAPABILITIES_TEXT = `# Carbone — Document Generation & Conversion

## Tools available

| Tool                       | Purpose                                                  |
|----------------------------|----------------------------------------------------------|
| convert_document           | Convert any document between 100+ formats (no template)  |
| render_document            | Generate a document from a template + JSON data          |
| list_templates             | List stored templates (filter by category, search, limit)|
| list_categories            | List all template categories in your account             |
| list_tags                  | List all tags used across your templates                 |
| upload_template            | Upload and store a reusable template                     |
| update_template_metadata   | Rename, re-categorise, deploy, or expire a template      |
| delete_template            | Soft-delete a template                                   |
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

Use \`convert_document\` to convert between formats instantly. No template required.

**Accepted file input:** local path, HTTPS URL, or base64 string.

**Common conversions:**
- DOCX / XLSX / PPTX / ODT → PDF  (converter: "L" LibreOffice)
- HTML → PDF                       (converter: "C" Chromium — full CSS/JS rendering)
- DOCX → HTML, TXT, MD
- PPTX / DOCX → PNG, JPG, WEBP    (rasterised slides/pages)
- XLSX → CSV
- Markdown → PDF, DOCX, ODT
- PDF → DOCX, ODT, TXT            (text extraction)

**Converter engines** (applies to PDF and rasterised image output):
- \`L\` — LibreOffice (default) — best all-round for Office documents
- \`O\` — OnlyOffice — highest fidelity for DOCX / XLSX / PPTX
- \`C\` — Chromium — best for HTML/CSS/JS content

**Advanced PDF options** (via \`formatOptions\`):
- Password protection: \`{ "EncryptFile": true, "DocumentOpenPassword": "secret" }\`
- Watermark: \`{ "Watermarks": [{ "text": "CONFIDENTIAL", "opacity": 0.1, "rotation": -45 }] }\`
- PDF/A compliance: \`{ "SelectPdfVersion": 1 }\`
- Page range: \`{ "PageRange": "1-3" }\`

Full conversion matrix: https://carbone.io/documentation/developer/http-api/generate-reports.md

---

## 2. Template-Based Generation

> **Authoring from scratch?** LLMs can write HTML documents or templates directly:
> - **HTML or Markdown with Carbone tags** → use as a template with \`render_document\`. Strongly recommended: load \`carbone.skill\` (see Documentation) as the reference for Universal Carbone Templating syntax and validate all tag structures before rendering.
> - **Plain HTML or Markdown (no Carbone tags)** → static document, use \`convert_document\` to produce PDF, DOCX, etc.
> - **DOCX / XLSX / PPTX editing** → if the LLM supports editing Office files, Carbone tags can be injected directly into existing DOCX, XLSX, or PPTX files to create or update templates. The same \`carbone.skill\` syntax applies.

Two modes — choose based on whether you need to reuse the template:

**Mode A — Stored template (reusable):**
1. Design a template in Word / Excel / LibreOffice / HTML / Markdown with \`{d.field}\` tags
2. Upload it with \`upload_template\` → get a Template ID
3. Call \`render_document\` with \`templateId\`, your JSON data, and \`convertTo\` (e.g. \`"pdf"\`)

**Mode B — Inline template (one-shot, no storage):**
1. Call \`render_document\` with \`template\` (file path, URL, or base64), your JSON data, and \`convertTo\`
2. The template is uploaded and rendered in a single request — no Template ID is returned

**Output format:** \`convertTo\` controls the generated file format (e.g. \`"pdf"\`, \`"docx"\`, \`"xlsx"\`, \`"html"\`). Defaults to the template's own format if omitted.

**Template data tags (quick reference):**
- \`{d.customer.name}\`            — simple field access
- \`{c.company}\`                  — complement data (static/shared values passed via \`complement\`)
- \`{d.price:formatC(EUR)}\`       — currency formatter
- \`{d.date:formatD(YYYY-MM-DD)}\` — date formatter
- \`{d.items[i].description}\`     — array loop start
- \`{d.items[i+1]}\`               — array loop end
- \`{t(label)}\`                     — translation tag (requires \`lang\` + \`translations\`)
- \`{d.status:ifEQ(active):show(Yes):elseShow(No)}\` — conditional (inline value)
- \`{d.show:ifEQ(true):showBegin}\` … \`{d.show:ifEQ(true):showEnd}\` — conditional block

> For the full syntax reference — all formatters, conditions, loops, and translations — load \`carbone.skill\` (see Documentation).

**Async rendering** (single document, non-blocking):
- Pass a \`webhookUrl\` in the \`render_document\` call to render asynchronously (timeout: **5 minutes**, vs 1 minute for synchronous).
- Carbone will POST the generated document (or an error payload) to your URL when done.
- The \`render_document\` call returns immediately with a render ID; no document content is returned inline.

**Batch generation** (one request → hundreds of documents):
- **Batch rendering is always asynchronous** — you MUST provide a \`webhookUrl\` (same 5-minute timeout applies).
- Set \`batchSplitBy\` to the array path driving the batch (e.g. \`"d.invoices"\`)
- Set \`batchOutput\` to \`"zip"\` to receive all documents in a single ZIP archive
- Set \`batchReportName\` to name each file (e.g. \`"invoice-{d.id}.pdf"\`)

**PDF form filling:**
- Use a PDF with fillable form fields as the template
- Pass field values in \`data\` — Carbone maps them to the PDF form fields automatically

---

## 3. Supported Output Formats (selection)

Documents: PDF, DOCX, XLSX, PPTX, ODT, ODS, ODP, ODG, HTML, TXT, CSV, MD, XML, RTF, EPUB
Images:    PNG, JPG, WEBP, SVG, TIFF, BMP, GIF
Archive:   ZIP (batch output — use with batchSplitBy)

---

## Documentation

All Carbone docs are LLM-friendly: replace \`.html\` with \`.md\` on any documentation URL for the Markdown
version, or load the whole corpus at once via the llms.txt files below.
- llms.txt (doc index):  https://carbone.io/llms.txt
- llms-full.txt (full):  https://carbone.io/llms-full.txt
- API reference:         https://carbone.io/documentation/developer/http-api/introduction.md
- OpenAPI spec:          https://carbone.io/file/carbone.OpenAPI.yml
- Template tags syntax:  https://carbone.io/documentation/design/overview/getting-started.md
- HTML templates guide:  https://carbone.io/documentation/design/template-formats/html.md
- Markdown templates:    https://carbone.io/documentation/design/template-formats/markdown.md
- MCP server docs:       https://carbone.io/documentation/developer/ai/mcp.md
- Changelog:             https://carbone.io/changelog.md

**Carbone Skill (AI deep knowledge):**
For deep knowledge of Carbone's templating syntax, formatters, and best practices, load the Carbone Skill.
Compatible with any AI assistant that supports the Agent Skills standard (agentskills.io):
- Skill file (ZIP):     https://github.com/carboneio/carbone-skill/releases/latest/download/carbone.skill
- Skill documentation:  https://carbone.io/documentation/developer/ai/skills.md
- GitHub repository:    https://github.com/carboneio/carbone-skill
`;

export function handleGetCapabilities() {
  return {
    content: [{ type: 'text' as const, text: CAPABILITIES_TEXT }],
  };
}
