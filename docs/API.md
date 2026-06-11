# Carbone MCP — API Reference

Full parameter reference for all 11 tools exposed by the Carbone MCP server.

## Table of Contents

**Document Operations**
- [convert\_document](#convert_document)
- [render\_document](#render_document)

**Template Management**
- [list\_templates](#list_templates)
- [list\_categories](#list_categories)
- [list\_tags](#list_tags)
- [upload\_template](#upload_template)
- [update\_template\_metadata](#update_template_metadata)
- [delete\_template](#delete_template)
- [download\_template](#download_template)

**Discovery**
- [get\_api\_status](#get_api_status)
- [get\_capabilities](#get_capabilities)

**Server**
- [Transport modes](#transport-modes)
- [Health endpoint](#health-endpoint)

---

## `convert_document`

Convert any document to another format without storing a template.

**File input:** local path, HTTPS URL, or base64 string.

```
Convert /path/to/report.docx to PDF
Convert https://example.com/presentation.pptx to PNG
Convert this HTML to PDF: <h1>Hello</h1>
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | ✅ | File path, HTTPS URL, or base64 string |
| `convertTo` | string \| object | ✅ | Target format (`"pdf"`, `"docx"`, `"png"`, …) or advanced object |
| `converter` | `L` \| `O` \| `C` | ❌ | Converter engine (default: `L` LibreOffice) |

**`converter` options:**
- `L` — LibreOffice (default): best all-round engine for DOCX, XLSX, PPTX, ODT
- `O` — OnlyOffice: highest fidelity for Microsoft Office formats
- `C` — Chromium: best for HTML/CSS/JS — full browser rendering

**Advanced `convertTo` object:**
```json
{
  "formatName": "pdf",
  "formatOptions": {
    "EncryptFile": true,
    "DocumentOpenPassword": "secret",
    "DocumentPermissionPassword": "owner",
    "Watermarks": [{ "text": "CONFIDENTIAL", "opacity": 0.1, "rotation": -45 }],
    "SelectPdfVersion": 1,
    "PageRange": "1-3,5"
  }
}
```

**`formatOptions` reference:**

| Option | Format | Description |
|---|---|---|
| `EncryptFile` | PDF | Enable password protection |
| `DocumentOpenPassword` | PDF | Password to open the document |
| `DocumentPermissionPassword` | PDF | Owner/permissions password |
| `Watermarks` | PDF | Up to 5 watermarks with `text`, `opacity`, `rotation`, `fontsize` |
| `SelectPdfVersion` | PDF | `1` = PDF/A-1b, `2` = PDF/A-2, `3` = PDF/A-3 |
| `PageRange` | PDF | Export specific pages, e.g. `"1-3,5"` |
| `ConvertSlideshow` | PDF | Convert each slide to a separate page |
| `Quality` | PNG/JPG/WEBP | Compression quality 0–100 |
| `density` | PNG/JPG/WEBP | DPI for rasterisation (default: 96) |
| `fieldSeparator` | CSV | Custom column separator |

---

## `render_document`

Generate a document by merging a Carbone template with JSON data.

**Provide exactly one of:** `templateId` or `template` (never both).

```
Generate an invoice using template abc123 with { "customer": "Acme", "total": 1500 }
Render /path/to/invoice.docx with { "customer": "Acme" } and convert to PDF
```

### Template source (exactly one required)

| Parameter | Type | Description |
|---|---|---|
| `templateId` | string | Template ID (64-bit) or Version ID (SHA-256) returned by `upload_template` |
| `template` | string | File path, URL, or base64 — uploaded and rendered in a single request |

### Data & output

| Parameter | Type | Description |
|---|---|---|
| `data` | object | JSON data injected into `{d.field}` tags |
| `convertTo` | string \| object | Convert output to a different format (e.g. `"pdf"`) |
| `converter` | `L` \| `O` \| `C` | PDF converter engine (see `convert_document`) |
| `reportName` | string | Output filename, supports Carbone tags (e.g. `"{d.client}-invoice.pdf"`) |

### Localisation & formatting

| Parameter | Type | Description |
|---|---|---|
| `lang` | string | BCP-47 locale (e.g. `"fr-fr"`, `"en-us"`) — affects number/currency/translation formatting |
| `timezone` | string | IANA timezone for date formatting (e.g. `"America/New_York"`) |
| `translations` | object | Translation map for `{t(key)}` tags: `{ "fr-fr": { "hello": "Bonjour" } }` |
| `complement` | object | Extra data accessible via `{c.field}` tags (e.g. company info, logos) |
| `enum` | object | Enum map for `:convEnum(TYPE)`: `{ "STATUS": { "1": "Active" } }` |
| `variableStr` | string | Alias expressions evaluated before rendering: `"{#total = d.price * d.qty}"` |
| `currencySource` | string | ISO 4217 source currency (e.g. `"EUR"`) |
| `currencyTarget` | string | ISO 4217 target currency (e.g. `"USD"`) |
| `currencyRates` | object | Exchange rates: `{ "EUR": 1, "USD": 1.08 }` |
| `hardRefresh` | boolean | Recompute TOC and pagination after render (requires `convertTo`) |

### Async & webhook

| Parameter | Type | Description |
|---|---|---|
| `webhookUrl` | string | URL to POST the result to when rendering completes (enables async mode, 5-minute timeout) |
| `webhookHeaders` | object | Additional headers sent with the webhook POST (e.g. auth headers) |

### Batch generation

> **Batch rendering is always asynchronous** — `webhookUrl` is required.

| Parameter | Type | Description |
|---|---|---|
| `batchSplitBy` | string | JSON path to array driving batch: `"d.invoices"` → one doc per invoice |
| `batchOutput` | string | Container for batch result: `"zip"` |
| `batchReportName` | string | Filename per document in ZIP: `"invoice-{d.id}.pdf"` |

---

## `list_templates`

List stored templates with filtering, search, and pagination.

| Parameter | Type | Description |
|---|---|---|
| `id` | string? | Filter by Template ID (64-bit) |
| `versionId` | string? | Filter by Version ID (SHA-256) |
| `category` | string? | Filter by category (e.g. `"invoices"`) |
| `origin` | number? | `0` = uploaded via API, `1` = uploaded via Carbone Studio |
| `search` | string? | Fuzzy search on name, or exact match on Template ID / Version ID |
| `includeVersions` | boolean? | Return full version history (default: `false`) |
| `limit` | number? | Max results (default: 100) |
| `cursor` | string? | Pagination cursor from previous `nextCursor` |

---

## `upload_template`

Store a reusable template in Carbone.

```
Upload /path/to/invoice.docx as "Invoice Template", category "invoices"
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `template` | string | ✅ | File path, URL, or base64 |
| `name` | string | ✅ | Display name |
| `id` | string? | ❌ | Existing Template ID to add this upload as a new version |
| `versioning` | boolean? | ❌ | Enable versioning (default: `true`) |
| `category` | string? | ❌ | Category (e.g. `"invoices"`) |
| `comment` | string? | ❌ | Free-text note about this version |
| `tags` | string[]? | ❌ | Tags (e.g. `["sales", "v2"]`) |
| `sample` | object[]? | ❌ | Sample data for Carbone Studio preview |
| `deployedAt` | number? | ❌ | Unix timestamp to set as deploy time. Use `42000000000` for "now". |
| `expireAt` | number? | ❌ | Unix timestamp for automatic deletion. Use `42000000000` for "now". |

**Response:**
```
Template uploaded successfully!

Template ID : 12345678901234567
Version ID  : sha256abc...
Name        : Invoice Template
```

---

## `update_template_metadata`

Rename, re-categorise, deploy a version, or schedule deletion.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `templateId` | string | ✅ | Template ID (updates all versions) or Version ID (updates one version) |
| `name` | string? | ❌ | New display name |
| `comment` | string? | ❌ | New free-text comment |
| `category` | string? | ❌ | New category |
| `tags` | string[]? | ❌ | New tags — replaces existing tags entirely |
| `deployedAt` | number? | ❌ | Unix timestamp to activate this version. Use `42000000000` for "now". |
| `expireAt` | number? | ❌ | Unix timestamp for automatic deletion. Use `42000000000` for "now". |

---

## `delete_template`

Soft-delete a template (marked for removal, deleted after ~24h).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `templateId` | string | ✅ | Template ID (deletes all versions) or Version ID (deletes one version) |

For immediate or scheduled deletion, use `update_template_metadata` with `expireAt = 42000000000`.

---

## `download_template`

Download the original template file (DOCX, XLSX, etc.).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `templateId` | string | ✅ | Template ID (downloads deployed version) or Version ID (downloads exact version) |

---

## `list_categories`

List all template categories in your account. No parameters.

Returns an array of category name strings.

---

## `list_tags`

List all tags used across your templates. No parameters.

Returns an array of tag name strings.

---

## `get_api_status`

Check Carbone API health and current version. No parameters.

Returns the API version string and a status message.

---

## `get_capabilities`

Returns a full overview of supported formats, features, and usage examples. No parameters.

---

## Transport modes

The server supports two transport modes controlled by the `MCP_TRANSPORT` environment variable.

### `stdio` (default)

Used by AI desktop clients (Claude Desktop, VS Code, Cursor). The client launches the server as a child process and communicates over stdin/stdout.

```bash
CARBONE_API_KEY=your_key npx carbone-mcp
```

`CARBONE_API_KEY` is **required** at startup when targeting the Carbone cloud API (`https://api.carbone.io`). It can be omitted when `CARBONE_BASE_URL` points to an on-premise server.

### `http`

Runs a Streamable HTTP server. Used for self-hosted deployments accessible to web-based or remote MCP clients.

```bash
MCP_TRANSPORT=http MCP_PORT=3000 node dist/index.js
```

`CARBONE_API_KEY` is **optional** in HTTP mode. Each incoming request can supply its own key via the `Authorization: Bearer <key>` header, which takes precedence over the server-level env var. This allows multiple users to connect with their own API keys without sharing a single server-level key.

| Auth scenario | Behaviour |
|---|---|
| `CARBONE_API_KEY` set at startup | Used as fallback for requests without a Bearer token |
| Bearer token in request | Always takes precedence over the server-level key |
| Neither set, cloud API | Request fails with `401 Unauthorized` at tool execution |
| On-premise (`CARBONE_BASE_URL` custom) | No key required in any mode |

**HTTP environment variables:**

| Variable | Default | Description |
|---|---|---|
| `MCP_PORT` | `3000` | Listening port |
| `MCP_PATH` | `/` | MCP endpoint path. Cannot be `/health` (reserved). |
| `MCP_MAX_BODY_BYTES` | `62914560` | Maximum request body size (60 MB, matches Carbone Cloud limit). Returns HTTP 413 when exceeded. |

---

## Health endpoint

Available in HTTP mode at `GET /health`. Always returns HTTP 200 — the status code signals MCP server liveness.

```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "mcp":    { "version": "1.1.4" },
  "carbone": { "version": "4.x.x" }
}
```

The `carbone` field reflects backend connectivity:

| Value | Meaning |
|---|---|
| `{ "version": "..." }` | Reachable and authenticated |
| `{ "error": "unauthorized", "message": "..." }` | Reachable but no/invalid API key |
| `{ "error": "unreachable", "message": "..." }` | Network error, timeout, or unexpected response |

The response is cached for 30 seconds to avoid hammering the backend. Backend status changes are logged to stderr.

---

## Supported Output Formats

```
Documents: pdf, docx, xlsx, pptx, odt, ods, odp, odg, rtf, epub
Web/Text:  html, xhtml, txt, csv, md, xml, idml
Images:    png, jpg, jpeg, webp, svg, tiff, bmp, gif
Archive:   zip
```

Full conversion matrix: [carbone.io documentation](https://carbone.io/documentation/developer/http-api/generate-reports.html#output-file-type)
