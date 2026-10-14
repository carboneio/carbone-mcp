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

Convert a document to another format without storing a template. This is a **pure conversion**: no data is sent, so Carbone tags such as `{d.name}` are kept as written (use `render_document` to fill them).

**File input:** local path, HTTPS URL, or base64 string. Input formats: DOCX, DOC, XLSX, XLS, PPTX, PPT, PDF, ODT, ODS, ODP, ODG, RTF, TXT, CSV, HTML, XHTML, MD, IDML, XML.

```
Convert /path/to/report.docx to PDF
Convert https://example.com/presentation.pptx to PNG
Convert this HTML to PDF: <h1>Hello</h1>
Render /path/to/report.pdf as a PNG thumbnail
```

> **PDF as input:** a PDF converts to `docx`, `odt`, `html` or `txt`, to an image (`png`, `jpg`, `webp`), or is re-saved as `pdf` (e.g. to add a password, watermarks or PDF/A).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | ✅ | File path, HTTPS URL, or base64 string |
| `convertTo` | string \| object | ✅ | Target format (see [Supported Output Formats](#supported-output-formats)) or advanced object. Valid outputs depend on the input format |
| `converter` | `L` \| `O` \| `C` \| `I` | ❌ | Converter engine (default: `L` LibreOffice) |
| `hardRefresh` | boolean | ❌ | Recompute pagination and the table of contents at the end of the conversion (used in Carbone's PDF → PDF/A-4 example) |
| `outputPath` | string | ❌ | **stdio only** — save the result to this local path (see [Output & file delivery](#output--file-delivery)) |
| `asAttachment` | boolean | ❌ | Return the bytes as a downloadable attachment instead of inline |
| `returnLink` | boolean | ❌ | Return a public **one-time** download URL instead of the file |
| `egressAuthorization` | string | ❌ | `Authorization` header value Carbone adds when fetching protected external assets during conversion (e.g. a Chromium HTML→PDF fetching a secured image). Max 511 chars |

**`converter` options** (used whenever the format changes, not only for PDF):
- `L` — LibreOffice (default): DOCX, XLSX, PPTX, ODT, ODS, ODP, ODG, MD, PDF; the only converter supporting all PDF options
- `I` — Carbone ICE: DOCX and ODT (beta) → PDF; the fastest, recommended over `O` for DOCX from Carbone v5.15.0
- `O` — OnlyOffice: DOCX, XLSX, PPTX → PDF
- `C` — Chromium: HTML → PDF, JPG, PNG, WEBP with full CSS/JS; 100 MB max

`O`, `C` and `I` support only the Security (passwords, permissions) and Watermark PDF options.

**Advanced `convertTo` object:**
```json
{
  "formatName": "pdf",
  "formatOptions": {
    "EncryptFile": true,
    "DocumentOpenPassword": "secret",
    "RestrictPermissions": true,
    "PermissionPassword": "owner",
    "Watermarks": [{ "text": "CONFIDENTIAL", "size": 60, "opacity": 0.1, "rotation": -45 }],
    "SelectPdfVersion": 2,
    "PageRange": "1-5"
  }
}
```

**`formatOptions` reference** (common keys; full list in the [Carbone documentation](https://carbone.io/documentation/developer/http-api/generate-reports.html#pdf-options)):

| Option | Format | Description |
|---|---|---|
| `EncryptFile` | PDF | Encrypt the PDF; requires `DocumentOpenPassword` |
| `DocumentOpenPassword` | PDF | Password to open the document |
| `RestrictPermissions` | PDF | Restrict printing, copying and changes; use with `PermissionPassword` |
| `PermissionPassword` | PDF | Password to change the restricted permissions |
| `Watermarks` | PDF | Up to 4 watermarks: `text` (required), `size`, `opacity`, `rotation`, `anchor`, `color`, … |
| `SelectPdfVersion` | PDF (`L` only) | `1`–`4` = PDF/A-1 to PDF/A-4; `15`, `16`, `17`, `20` = PDF 1.5, 1.6, 1.7, 2.0 |
| `PageRange` | PDF (`L` only) | Export specific pages, e.g. `"1-5"` |
| `UseTaggedPDF` / `PDFUACompliance` | PDF (`L` only) | Tagged PDF / PDF/UA accessibility |
| `PixelWidth` / `PixelHeight` | PNG/JPG | Output image size in pixels |
| `Quality` | JPG | Quality 1–100 |
| `fieldSeparator` | CSV | Custom column separator, e.g. `";"` |

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
| `data` | object \| array \| string | **Optional** — JSON data injected into `{d.field}` tags. Accepts an object, a top-level array (`{d[i].field}`), **or** a string reference to a JSON file (see [Pass JSON by reference](#pass-json-by-reference)). If omitted, `{}` is sent, so every tag resolves to empty; to convert a file and keep its tags, use `convert_document` |
| `convertTo` | string \| object | Convert output to a different format (e.g. `"pdf"`); same values and `formatOptions` as `convert_document` |
| `converter` | `L` \| `O` \| `C` \| `I` | Converter engine (see `convert_document`) |
| `reportName` | string | Output filename **without extension** (Carbone appends it), supports Carbone tags (e.g. `"{d.client}-invoice"`) |
| `failOn` | string[] | Conditions that stop the render with an error (Carbone v5.15.0+). `["IMAGE_URL_ERROR"]`: an image that cannot be downloaded from its URL fails the render instead of showing a broken-image placeholder |
| `preReleaseFeatureIn` | integer | Pre-release feature level for this render only (e.g. `5000000`) |
| `outputPath` | string | **stdio only** — save the result to this local path (see [Output & file delivery](#output--file-delivery)) |
| `asAttachment` | boolean | Return the bytes as a downloadable attachment instead of inline |
| `returnLink` | boolean | Return a public **one-time** download URL instead of the file. Ignored when `webhookUrl` is set |

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
| `webhookUrl` | string | Enables async rendering (5-minute timeout). The tool then returns only Carbone's acceptance message, never the document: Carbone POSTs `{ "success": true, "data": { "renderId": "…" } }` to this URL, and the server behind it downloads the document from `GET /render/{renderId}` (one-time, no auth). The agent cannot fetch it. `outputPath`, `asAttachment` and `returnLink` are ignored |
| `webhookHeaders` | object | Additional headers sent with the webhook POST (e.g. auth headers) |
| `egressAuthorization` | string | `Authorization` header value Carbone adds to its **outbound** requests while rendering — external images (`{d.imageUrl}`), external PDFs (`:appendFile`/`:attachFile`), and webhooks. Max 511 chars. `webhookHeaders.authorization` overrides it for webhook calls only |

### Batch generation

> **Batch rendering is always asynchronous** — `webhookUrl` is required, and the result is delivered to the webhook as above. At most 100 objects per batch on Carbone Cloud.

| Parameter | Type | Description |
|---|---|---|
| `batchSplitBy` | string | One document per object of an array: `"d"` when `data` is itself an array, or `"d.items"` for a direct child array |
| `batchOutput` | `"zip"` \| `"pdf"` | `"zip"` (default): one archive of all documents. `"pdf"`: the PDFs concatenated into one file (requires `convertTo: "pdf"`) |
| `batchReportName` | string | Name of each file in the ZIP, **without extension**, Carbone tags allowed (e.g. `"invoice-{d.id}"`). Ignored with `batchOutput: "pdf"`. From Carbone v5.14, an index is appended to every file when two names collide |

### Pass JSON by reference

The JSON-valued parameters — `data`, `complement`, `translations`, `enum`, `currencyRates` — can be given **inline** (an object, or an array for `data`) or as a **string reference** that the server reads and parses. This keeps large datasets (and big translation maps) out of the tool call, cutting token cost — especially for batch.

A string value is resolved as:

| Reference | Resolved as | stdio | HTTP |
|---|---|---|---|
| `"/data/invoices.json"`, `"~/data.json"` | local file → parsed JSON | ✅ | ❌ refused — stdio only |
| `"https://example.com/data.json"` | downloaded → parsed JSON | ✅ | ✅ |
| base64 of a JSON document | decoded → parsed JSON | ✅ | ✅ |
| `'{"customer":"Acme"}'` / `'[…]'` | parsed directly as inline JSON | ✅ | ✅ |

```
Render template T123 with the data in /data/invoices.json, output PDF
Render T123 with translations from https://cdn.example.com/i18n.json, lang fr-fr
```

> A string is never ambiguous with inline JSON: inline data is passed as an object/array, so a string always means "reference". Same size guard (`CARBONE_MAX_FILE_BYTES`) and URL timeout as `file` / `template`.

---

## Output & file delivery

`convert_document` and `render_document` (and `download_template`, for `outputPath` / `asAttachment`) decide how the generated bytes reach the client. By default this depends on the format and the transport:

| Output | stdio (local clients) | HTTP (remote / self-hosted) |
|---|---|---|
| Text — HTML, XHTML, TXT, CSV, MD, XML, JSON (template samples) | inline `text` | inline `text` |
| Inline images — PNG, JPG, GIF, WEBP | inline `image` | inline `image` |
| Everything else — PDF, Office, SVG, TIFF, BMP, EMF… | saved to a temp file, **path returned** as text | returned as an `EmbeddedResource` **attachment** |

Override the default with these optional parameters:

| Parameter | Behaviour |
|---|---|
| `outputPath` | **stdio only.** Write the output to this local path and return a summary instead of the bytes. In HTTP mode it is rejected (the file would land on the server, not your machine). |
| `asAttachment` | Return the bytes as an `EmbeddedResource` download attachment for **any** format (including text/images), instead of inlining. |
| `returnLink` | Render without returning the bytes; instead return Carbone's public download URL (`<API URL>/render/{renderId}`). The link is **one-time and short-lived** — Carbone deletes the file after the first download — so pass it to the end user and do **not** fetch it yourself. Works in both transports. Mutually exclusive with `outputPath` / `asAttachment`; ignored when `webhookUrl` is set. |

> **Claude Desktop note:** Claude Desktop (and claude.ai) mis-handle inline binary `EmbeddedResource` blobs — they coerce them into image blocks and reject the media type. The same blocks render correctly in Cursor, VS Code, and the MCP Inspector. For PDFs/Office files in Claude Desktop, use the default stdio temp-file path or `returnLink`.

---

## `list_templates`

List stored templates with filtering, search, and pagination.

| Parameter | Type | Description |
|---|---|---|
| `id` | string? | Filter by Template ID (64-bit) |
| `versionId` | string? | Filter by Version ID (SHA-256) |
| `category` | string? | Filter by category (e.g. `"invoices"`) |
| `origin` | number? | Upload origin: `0` = API, `1` = Carbone Studio, `2` = Salesforce, `3` = Odoo, `4` = HubSpot integration |
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
| `name` | string? | ❌ | Display name, max 200 chars. Recommended: `list_templates` shows it and its search matches it |
| `id` | string? | ❌ | Existing Template ID to add this upload as a new version |
| `versioning` | boolean? | ❌ | Enable versioning (default: `true`). `false` returns only `templateId` (SHA-256) and `templateExtension` |
| `category` | string? | ❌ | Category (e.g. `"invoices"`), max 200 chars |
| `comment` | string? | ❌ | Free-text note about this version, max 200 chars |
| `tags` | string[]? | ❌ | Tags (e.g. `["sales", "v2"]`). Duplicates are removed and the list is sorted; the whole list is limited to 100 characters. `list_templates` cannot filter by tag |
| `sample` | object[]? | ❌ | Sample data for Carbone Studio: **at most one** object, with the optional keys `data`, `complement`, `translations`, `enum` (no other keys) |
| `deployedAt` | number? | ❌ | Unix timestamp to set as deploy time. Use `42000000000` for "now". Future values are not allowed |
| `expireAt` | number? | ❌ | Unix timestamp at which the template is scheduled for deletion; `0` (default) = never. To delete now, use `delete_template` |

**Response:**
```
Template uploaded successfully!

Template ID : 1530905183164918624
Version ID  : 929a…
Type        : html
Size        : 46 bytes
Deployed at : 0 (not explicitly deployed: if another version of this Template ID is deployed, renders by Template ID keep using it). To use this version, deploy it with update_template_metadata (templateId = this Version ID, deployedAt = 42000000000), or render it by its Version ID.
Name        : Invoice Template
```

Structured output: `id`, `versionId`, `type`, `size`, `createdAt`, `deployedAt` (versioned mode) or `templateId`, `templateExtension` (versioning disabled), plus `name` when one was given. `deployedAt` is `0` when the version is not explicitly deployed.

---

## `update_template_metadata`

Rename, re-categorise, tag, deploy, schedule the deletion of, or move **one** template version.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `templateId` | string | ✅ | Template ID (patches only its **currently deployed** version) or Version ID (patches that exact version) |
| `moveToTemplateId` | string? | ❌ | **Structural change:** moves the patched version to this other Template ID (the API's `id` body field). Pass the Version ID as `templateId`; with a Template ID, its deployed version is moved and that Template ID falls back to its next most recent version |
| `name` | string? | ❌ | New display name, max 200 chars |
| `comment` | string? | ❌ | New free-text comment, max 200 chars |
| `category` | string? | ❌ | New category, max 200 chars |
| `tags` | string[]? | ❌ | New tags — replaces existing tags entirely (same rules as `upload_template`) |
| `deployedAt` | number? | ❌ | Unix timestamp to activate this version. Use `42000000000` for "now". Future values are not allowed, and the deployed version's `deployedAt` cannot move back in time |
| `expireAt` | number? | ❌ | Unix timestamp at which the patched version is scheduled for deletion. `0` cancels a scheduled deletion; omit it to leave the expiration unchanged |

**Response:**
```
Template metadata updated for version 929a… (the currently deployed version of Template ID 1530905183164918624).
Updated fields: {"name":"Invoice v2"}
```

Structured output: `versionId` (the patched version) plus the updated fields echoed back by Carbone (`id`, `name`, `comment`, `category`, `tags`, `deployedAt`, `expireAt`).

---

## `delete_template`

Delete a template. Takes effect immediately: it is no longer listed, downloadable or renderable (`404`); the file itself is purged after the retention delay (Carbone Cloud: 24 hours).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `templateId` | string | ✅ | Template ID (deletes all versions) or Version ID (deletes one version) |

To schedule a deletion instead, use `update_template_metadata` with `expireAt` set to a future Unix timestamp.

---

## `download_template`

Download the original template file (DOCX, XLSX, etc.), or the JSON sample data stored with it.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `templateId` | string | ✅ | Template ID (downloads deployed version) or Version ID (downloads exact version). Use `<id>_sample.json` to download the JSON sample data stored with it, returned inline as JSON |
| `outputPath` | string? | ❌ | **stdio only** — save the file to this local path |
| `asAttachment` | boolean? | ❌ | Return the file as a downloadable attachment instead of inline |

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
| `MCP_ALLOWED_ORIGINS` | `localhost`, `127.0.0.1`, `[::1]` | Browser `Origin` hostnames allowed in addition to the localhost default — comma-separated, without scheme or port (e.g. `app.example.com`); `<scheme>://*` allows a browser-extension scheme (e.g. `moz-extension://*`). Invalid entries stop the server at startup. |
| `CARBONE_REQUIRE_CLIENT_AUTH_HEADER` | `false` | Require `Authorization: Bearer <key>` on every request. Left `false`, a request with no Bearer key falls back to the server-level `CARBONE_API_KEY` (a shared-key server — anyone reaching the port can spend it). Set `true` to require per-client keys. No effect when no server key is set. |
| `CARBONE_ALLOW_PRIVATE_NETWORK` | `false` | Allow user-supplied URLs to resolve to private/internal addresses. Off by default to block SSRF. |

**Endpoint behaviour** (at `MCP_PATH`):

| Request | Response |
|---|---|
| `POST` | MCP over Streamable HTTP, stateless (no sessions). Serves protocol `2026-07-28` (`server/discover`, per-request `_meta`) and 2025-era clients that open with `initialize`. Closing the response stream cancels the request, including its upstream Carbone API call. |
| `GET`, `DELETE` | `405` — no standalone SSE stream, no sessions |
| `Origin` header present but not allowed | `403` before the request is processed (DNS-rebinding protection). Requests without an `Origin` header are unaffected. |
| Malformed or empty JSON body | `400` with JSON-RPC parse error `-32700` |
| Body over `MCP_MAX_BODY_BYTES` | `413` |

CORS preflights (`OPTIONS`) are answered `204`; allowed request headers are `Content-Type`, `Authorization`, `Mcp-Protocol-Version`, `Mcp-Method` and `Mcp-Name`.

---

## Health endpoint

Available in HTTP mode at `GET /health`. Always returns HTTP 200 — the status code signals MCP server liveness.

```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "mcp":    { "version": "1.x.x" },
  "carbone": { "version": "5.x.x" }
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

The 36 values accepted by `convertTo` (`src/validation/formats.ts`):

```
Documents:               pdf, docx, doc, odt, ott, rtf, epub
Spreadsheets:            xlsx, xls, ods, ots, csv, dbf, dif
Presentations, drawings: pptx, ppt, odp, otp, odg
Web/Text:                html, xhtml, txt, md, xml, idml
Images:                  png, jpg, jpeg, webp, gif, tiff, bmp, svg, emf, wmf, eps
```

Valid outputs depend on the input format. `zip` is not an output format: batch archives come from `batchOutput`.

Full conversion matrix: [carbone.io documentation](https://carbone.io/documentation/developer/http-api/generate-reports.html#output-file-type)
