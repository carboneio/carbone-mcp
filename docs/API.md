# Carbone MCP API reference

Full parameter reference for the 12 tools of the Carbone MCP server, and for running the server itself. For setup, start with the [README](../README.md).

## Table of contents

**Document operations**
- [convert\_document](#convert_document)
- [render\_document](#render_document)

**Template management**
- [inspect\_template](#inspect_template)
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
- [File inputs](#file-inputs)
- [Output & file delivery](#output--file-delivery)
- [Transport modes](#transport-modes)
- [Configuration](#configuration)
- [Health endpoint](#health-endpoint)
- [Supported output formats](#supported-output-formats)

---

## `convert_document`

Convert a document to another format without storing a template. This is a **pure conversion**: no data is sent, so Carbone tags such as `{d.name}` are kept as written (use `render_document` to fill them).

**File input:** absolute local path (stdio only), URL, or base64 string — see [File inputs](#file-inputs).

> **Accepted formats.** `convert_document` and `render_document` use the same Carbone endpoint and the same
> format validation, so they accept the same inputs: XML-based and text-based documents, plus PDF — `DOCX`,
> `XLSX`, `PPTX`, `ODT`, `ODS`, `ODP`, `ODG`, `HTML`, `XHTML`, `XML`, `SVG`, `IDML`, `MD`, `TXT`, `CSV`,
> `RTF`, `PDF`. The legacy **binary** formats `DOC`, `XLS` and `PPT` are **rejected as input** (415, error `w118`)
> even though Carbone can produce them as output — re-save them as `DOCX`/`XLSX`/`PPTX` first.

> **Carbone tags are preserved.** Converting a DOCX template to PDF shows the tags as written — that is how
> you proof a template's layout, or convert a template between formats (DOCX → ODT) while it stays a template.
> Use `render_document` to resolve tags into real values, or `render_document` with `keepTags` to proof a
> stored template.

```
Convert /path/to/report.docx to PDF
Convert https://example.com/presentation.pptx to PNG
Convert this HTML to PDF: <h1>Hello</h1>
Render /path/to/report.pdf as a PNG thumbnail
```

> **PDF as input:** a PDF converts to `docx`, `odt`, `html` or `txt`, to an image (`png`, `jpg`, `webp`), or is re-saved as `pdf` (e.g. to add a password, watermarks or PDF/A: the server sets `hardRefresh` for you, without which Carbone would return the PDF unchanged).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | ✅ | Absolute local path (stdio only), URL, or base64 string ([File inputs](#file-inputs)) |
| `convertTo` | string \| object | ✅ | Target format (see [Supported output formats](#supported-output-formats)) or advanced object. Valid outputs depend on the input format; `doc`, `xls` and `ppt` are output-only |
| `converter` | `L` \| `O` \| `C` \| `I` | ❌ | Converter engine (default: `L` LibreOffice) |
| `reportName` | string | ❌ | Name of the delivered file, **without** extension: the server names it `<reportName>.<ext>` (attachment name, and the default saved file name in stdio). The server names the file itself: a conversion has no templating pass, which is where Carbone resolves `reportName` (the file would otherwise be `report.<ext>`). Used literally — tags are not resolved. Ignored with `returnLink` and `outputPath` |
| `hardRefresh` | boolean | ❌ | Run the converter even when the output format equals the input format, and recompute pagination and the table of contents. Needed for **PDF → PDF**: without it Carbone returns the PDF unchanged and `formatOptions` (password, permissions, watermarks, PDF/A…) are not applied. **Set automatically** when the input is a PDF, `convertTo` is `pdf` and `formatOptions` are given; pass `false` to opt out |
| `outputPath` | string | ❌ | **stdio only** — save the result to this local path (see [Output & file delivery](#output--file-delivery)) |
| `asAttachment` | boolean | ❌ | Return the bytes as a downloadable attachment instead of inline |
| `returnLink` | boolean | ❌ | Return a public **one-time** download URL instead of the file |
| `egressAuthorization` | string | ❌ | `Authorization` header value Carbone adds when fetching protected external assets during conversion (e.g. a Chromium HTML→PDF fetching a secured image). Max 511 chars |

**`converter` options** (used whenever the format changes, not only for PDF):
- `L` — LibreOffice (default): DOCX, XLSX, PPTX, ODT, ODS, ODP, ODG, MD, PDF; the only converter supporting all PDF options
- `I` — Carbone ICE: DOCX and ODT → PDF; Carbone's own engine, 3x to 300x faster, recommended over `O` for DOCX from Carbone v5.15.0. It converts all content except WEBP and EMF/WMF images, SmartArt and complex charts (bar, line, area, pie and doughnut charts are drawn), comments, tracked changes, form fields and equations: keep the default `L` for documents with those. A missing font is replaced by Noto Sans ([Carbone's documentation](https://carbone.io/documentation/developer/http-api/generate-reports.html#converters-carbone-ice-limitations))
- `O` — OnlyOffice: DOCX, XLSX, PPTX → PDF
- `C` — Chromium: HTML → PDF, JPG, PNG, WEBP with full CSS/JS; 100 MB max

PDF options: `L` supports all of them; `O`, `C` and `I` apply Security (passwords, permissions) and Watermarks.

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
| `template` | string | Absolute local path (stdio only), URL, or base64 ([File inputs](#file-inputs)) — uploaded and rendered in a single request |

### Data & output

| Parameter | Type | Description |
|---|---|---|
| `data` | object \| array \| string | **Optional** — JSON data injected into `{d.field}` tags. Accepts an object, a top-level array (`{d[i].field}`), **or** a string reference to a JSON file (see [Pass JSON by reference](#pass-json-by-reference)). If omitted, `{}` is sent: templating still runs, so every tag resolves to an **empty string**; to keep the tags, use `keepTags` (or `convert_document` for a file) |
| `keepTags` | boolean | Skip templating entirely and leave every tag **as literal text** (`{d.customer}` stays `{d.customer}`). Use it to proof a stored template by `templateId`. Mutually exclusive with `data` — passing both is rejected |
| `convertTo` | string \| object | Convert output to a different format (e.g. `"pdf"`); same values and `formatOptions` as `convert_document` |
| `converter` | `L` \| `O` \| `C` \| `I` | Converter engine (see `convert_document`) |
| `reportName` | string | Output filename **without extension** (Carbone appends it), supports Carbone tags (e.g. `"{d.client}-invoice"`). With `keepTags` (no templating pass), the server names the file `<reportName>.<ext>` itself, literally |
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
| `enum` | object | Enum map for the `:convEnum` formatter: with `{ "STATUS": { "1": "Active" } }`, `{d.status:convEnum('STATUS')}` prints `Active` for `1` |
| `variableStr` | string | Predefined [aliases](https://carbone.io/documentation/design/substitutions/aliases.html), in the alias syntax `{#name = path}`: with `"{#total = d.order.total}"`, the template writes `{$total}` for `{d.order.total}`. An alias is a shortcut to a tag, not a computed value |
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
| `batchSplitBy` | string | One document per object of an array: `"d"` when `data` is itself an array, or `"d.items"` for a direct child array. At most 100 objects on Carbone Cloud |
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

## `inspect_template`

List the Carbone tags a template uses and return a sample JSON dataset matching its structure. Use it before `render_document` when you don't know which data a template expects.

**Provide exactly one of:** `templateId` or `template` (never both).

```
Which data does template 1530905183164918624 expect?
List the Carbone tags of /path/to/invoice.docx and give me sample data for it
```

| Parameter | Type | Description |
|---|---|---|
| `templateId` | string | A stored template: Template ID (64-bit, inspects its deployed version) or Version ID (SHA-256, inspects that exact version) |
| `template` | string | A template that is not stored, in the same forms as `render_document`'s `template`: absolute local path (stdio only), URL, or base64 ([File inputs](#file-inputs)) |

**Output:** a text summary (the tags, then the sample as JSON), and structured output:

| Field | Type | Description |
|---|---|---|
| `tags` | string[] | The tags as written in the template, e.g. `{d.customer.name}`, `{d.items[i].label}`, `{c.company}`. `{t()}` translation tags are not listed |
| `sample` | object | `data`: a sample dataset matching the template's structure, with placeholder values. `complement`: the same for `{c.}` tags, present when the template uses them. Replace the placeholder values, then pass `sample.data` as `render_document`'s `data` (and `sample.complement` as `complement`) |
| `signatures` | array? | The signature fields found in the template ([electronic signatures](https://carbone.io/documentation/design/advanced-features/signatures.html)). Present only when the template has any |
| `error` | object? | An error Carbone reported while inspecting the template. Present only when there is one |

The text summary also lists the signature fields and the error, when present.

> **Cost:** inspecting runs one render on your Carbone account (counted like a document generation) and discards the document. The tool is read-only: it changes no template and writes no local file.

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

## `list_categories`

List all template categories in your account. No parameters.

Returns an array of category name strings.

---

## `list_tags`

List all tags used across your templates. No parameters.

Returns an array of tag name strings.

---

## `upload_template`

Store a reusable template in Carbone.

```
Upload /path/to/invoice.docx as "Invoice Template", category "invoices"
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `template` | string | ✅ | Absolute local path (stdio only), URL, or base64 ([File inputs](#file-inputs)) |
| `name` | string? | ❌ | Display name, max 200 chars. Recommended: `list_templates` shows it and its search matches it |
| `id` | string? | ❌ | Existing Template ID to add this upload as a new version |
| `versioning` | boolean? | ❌ | Enable versioning (default: `true`). `false` returns only `templateId` (SHA-256) and `templateExtension` |
| `category` | string? | ❌ | Category (e.g. `"invoices"`), max 200 chars |
| `comment` | string? | ❌ | Free-text note about this version, max 200 chars |
| `tags` | string[]? | ❌ | Labels shown by `list_tags` and on each `list_templates` result (e.g. `["sales", "v2"]`). Duplicates are removed and the list is sorted; the whole list is limited to 100 characters |
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
| `id` | string? | ❌ | **Deprecated** — the 1.6.0 name of `moveToTemplateId`, still accepted. Passing both with different values is rejected |
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
| `templateId` | string | ✅ | Template ID (downloads deployed version) or Version ID (downloads exact version) |
| `sample` | boolean? | ❌ | `true` downloads the JSON sample dataset stored with the template (the `sample` passed to `upload_template`) instead of the template file, returned inline as JSON. Errors if the template has no sample |
| `outputPath` | string? | ❌ | **stdio only** — save the file to this local path |
| `asAttachment` | boolean? | ❌ | Return the file as a downloadable attachment instead of inline |

---

## `get_api_status`

Check Carbone API health and current version. No parameters.

Returns the API version string and a status message.

---

## `get_capabilities`

Returns a full overview of supported formats, features, and usage examples. No parameters.

---

## File inputs

`file` (`convert_document`) and `template` (`render_document`, `inspect_template`, `upload_template`) accept three forms:

| Form | Example | stdio | HTTP |
|---|---|---|---|
| Local path | `/Users/me/invoice.docx`, `~/invoice.docx`, `C:\Users\me\invoice.docx` | ✅ | ❌ refused — the server cannot read the caller's disk |
| URL (`http://` or `https://`) | `https://example.com/invoice.docx` | ✅ | ✅ |
| Base64 | the file content, base64-encoded | ✅ | ✅ |

A string that is neither a URL nor a path (starting with `/`, `./`, `../`, `~` or a drive letter) is taken as base64: a bare file name such as `invoice.docx` is **not** looked up and fails. Relative paths resolve against the server's working directory, which the client chooses, so prefer absolute paths. URLs are SSRF-guarded (see below), and every form is limited to `CARBONE_MAX_FILE_BYTES`. The JSON parameters passed by reference follow the same rules ([Pass JSON by reference](#pass-json-by-reference)).

### URL guard

The server downloads URL inputs itself (`file`, `template`, and JSON parameters such as `data` passed by reference), on both transports, with these protections:

- Only `http://` and `https://` URLs are fetched.
- Unless `CARBONE_ALLOW_PRIVATE_NETWORK=true`, a URL is refused when it points at a loopback, private (RFC 1918), link-local (including the cloud metadata address `169.254.169.254`), CGNAT, multicast or reserved address, in any IPv4 or IPv6 notation (including IPv4 addresses embedded in IPv6).
- The check applies to the address the connection actually uses, so a DNS answer cannot change between the check and the connection (DNS rebinding). Redirects are followed by the server, at most 5 hops, and every hop is checked again.
- A download stops as soon as it passes `CARBONE_MAX_FILE_BYTES`, and times out after 60 seconds.
- A call without an API key (when the Carbone API needs one) fails before anything is downloaded.
- A failed download reports only an HTTP status code or a fixed error code, never text chosen by the remote server.

Local paths are a separate guard: they are read in stdio only, where the server already runs as you. Over HTTP they are refused, so a remote caller can never make the server read its own filesystem.

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
| `outputPath` | **stdio only.** Write the output to this local path and return a summary instead of the bytes. The path must not exist yet: an existing file (or symlink) is never overwritten, and the new file is readable by the current user only (`0600`). In HTTP mode it is rejected (the file would land on the server, not your machine). |
| `asAttachment` | Return the bytes as an `EmbeddedResource` download attachment for **any** format (including text/images), instead of inlining. |
| `returnLink` | Render without returning the bytes; instead return Carbone's public download URL (`<API URL>/render/{renderId}`). The link is **one-time and short-lived** — Carbone deletes the file after the first download — so pass it to the end user and do **not** fetch it yourself. Works in both transports. Mutually exclusive with `outputPath` / `asAttachment`; ignored when `webhookUrl` is set. |

> **Claude Desktop note:** Claude Desktop (and claude.ai) mis-handle inline binary `EmbeddedResource` blobs — they coerce them into image blocks and reject the media type. The same blocks render correctly in Cursor, VS Code, and the MCP Inspector. For PDFs/Office files in Claude Desktop, use the default stdio temp-file path or `returnLink`.

---

## Transport modes

The server supports two transport modes, chosen with the `MCP_TRANSPORT` environment variable. It supports MCP protocol 2026-07-28 and still serves clients on the earlier 2025-era protocol, over both stdio and HTTP.

### `stdio` (default)

Used by AI desktop clients (Claude Desktop, Claude Code, VS Code, Cursor). The client launches the server as a child process and communicates over stdin/stdout.

```bash
CARBONE_API_KEY=your_key npx carbone-mcp
```

`CARBONE_API_KEY` is **required** at startup when targeting the Carbone cloud API (`https://api.carbone.io`). It can be omitted when `CARBONE_BASE_URL` points to an on-premise server.

### `http`

Runs a Streamable HTTP server. Used for self-hosted deployments accessible to web-based or remote MCP clients.

```bash
MCP_TRANSPORT=http MCP_PORT=3000 npx carbone-mcp

# or with Docker, where HTTP is the default
docker run -d -p 127.0.0.1:3000:3000 carbone/carbone-mcp
```

`CARBONE_API_KEY` is **optional** in HTTP mode. Each incoming request can supply its own key via the `Authorization: Bearer <key>` header, which takes precedence over the server-level env var. This allows multiple users to connect with their own API keys without sharing a single server-level key.

| Auth scenario | Behaviour |
|---|---|
| `CARBONE_API_KEY` set at startup | Used as fallback for requests without a Bearer token (a **shared-key server**: anyone who can reach the port spends that key; the server warns at startup) |
| `CARBONE_API_KEY` set and `CARBONE_REQUIRE_CLIENT_AUTH_HEADER=true` | No fallback: a request without a Bearer token gets the error below |
| Bearer token in request | Always takes precedence over the server-level key |
| Neither set, cloud API | The tool call returns the tool error `Authentication failed: No API key provided…` before anything is sent or downloaded |
| On-premise (`CARBONE_BASE_URL` custom) | No key required in any mode |

Deploying it: no server key (each client sends its own Bearer key) is the safe default. Publish the port on `127.0.0.1` for local use (`docker run -p 127.0.0.1:3000:3000 …`), and behind a TLS reverse proxy for remote clients. The HTTP settings (`MCP_PORT`, `MCP_PATH`, `MCP_ALLOWED_ORIGINS`, …) are listed under [Configuration](#configuration).

**Endpoint behaviour** (at `MCP_PATH`):

| Request | Response |
|---|---|
| `POST` | MCP over Streamable HTTP, stateless (no sessions). Serves protocol `2026-07-28` (`server/discover`, per-request `_meta`) and 2025-era clients that open with `initialize`. Closing the response stream cancels the request, including its upstream Carbone API call. |
| `GET`, `DELETE` | `405` `Method not allowed` — no standalone SSE stream, no sessions (opening the endpoint in a browser shows this) |
| `Origin` header present but not allowed | `403` before the request is processed (DNS-rebinding protection). Requests without an `Origin` header are unaffected. |
| Malformed or empty JSON body | `400` with JSON-RPC parse error `-32700` |
| Body over `MCP_MAX_BODY_BYTES` | `413` |

CORS preflights (`OPTIONS`) are answered `204`; allowed request headers are `Content-Type`, `Authorization`, `Mcp-Protocol-Version`, `Mcp-Method` and `Mcp-Name`.

---

## Configuration

The server reads these environment variables at startup. Numbers must be positive integers and booleans `true` or `false`; an invalid value stops the server with an error.

| Variable | Default | Description |
|---|---|---|
| `CARBONE_API_KEY` | none | Your Carbone API key ([account.carbone.io](https://account.carbone.io)). **stdio:** required for Carbone Cloud; without it the server stops at startup. **HTTP:** optional; leave it unset so each client sends its own `Authorization: Bearer <key>`, which always takes precedence. When set, requests without a Bearer key spend it (see `CARBONE_REQUIRE_CLIENT_AUTH_HEADER`). Not needed when `CARBONE_BASE_URL` points to an on-premise server. |
| `CARBONE_BASE_URL` | `https://api.carbone.io` | Carbone API base URL. Point it at your on-premise instance; with any URL other than the default, no API key is required. |
| `CARBONE_TIMEOUT` | `60000` | Timeout of each Carbone API request, in milliseconds. The server sets no maximum, but Carbone Cloud's synchronous API has its own 60-second limit. URL downloads have a separate, fixed 60-second timeout. |
| `CARBONE_MAX_FILE_BYTES` | `104857600` (100 MB) | Largest input the server resolves from a local path, URL or base64 string: `file`, `template`, and the JSON parameters passed by reference. A download stops as soon as it passes the limit. |
| `MCP_TRANSPORT` | `stdio` | `stdio` for local clients, or `http` for a Streamable HTTP server. The Docker image sets `http`. |
| `MCP_PORT` | `3000` | HTTP listening port. |
| `MCP_PATH` | `/` | HTTP endpoint path. Must start with `/` and cannot be `/health` (reserved). |
| `MCP_MAX_BODY_BYTES` | `62914560` (60 MB, Carbone Cloud's JSON data limit) | Largest incoming MCP message: an HTTP request body, answered `413` as soon as the limit is passed, or one stdio message. |
| `MCP_ALLOWED_ORIGINS` | none | HTTP only. Browser `Origin` hostnames allowed in addition to `localhost`, `127.0.0.1` and `[::1]`, which are always allowed: comma-separated, without scheme or port (e.g. `app.example.com`); `<scheme>://*` allows a browser-extension scheme (e.g. `moz-extension://*`). A request with any other `Origin` gets `403`; requests without an `Origin` are unaffected. Invalid entries stop the server at startup. |
| `CARBONE_REQUIRE_CLIENT_AUTH_HEADER` | `false` | HTTP only. `true` requires `Authorization: Bearer <key>` on every request. Left `false`, a request with no Bearer key falls back to the server-level `CARBONE_API_KEY` (a shared-key server: anyone reaching the port can spend it, and the server warns at startup). No effect when no server key is set. |
| `CARBONE_ALLOW_PRIVATE_NETWORK` | `false` | `true` lets URL inputs resolve to private and internal addresses ([URL guard](#url-guard)). Off by default to block SSRF; enable it only on a trusted deployment with internal template hosts. |
| `MCP_OPENAI_APPS_CHALLENGE` | none | HTTP only. The domain-verification token OpenAI gives when you submit the server to the ChatGPT plugin directory. When set, the server returns it as plain text at `/.well-known/openai-apps-challenge`. |

### Hosted server (OAuth mode)

Carbone uses these variables to run mcp.carbone.io. Self-hosted and on-premise servers leave them unset: OAuth mode needs this server to be registered as a resource server at account.carbone.io, which only Carbone does.

Setting `MCP_OAUTH_CLIENT_ID`, `MCP_OAUTH_CLIENT_SECRET` and `MCP_RESOURCE_URL` turns the HTTP server into an OAuth 2.1 resource server:

- MCP clients that implement MCP authorization (2025-06-18 or later) sign in with their Carbone account. A request without credentials gets `401` with a `WWW-Authenticate` challenge pointing to the protected-resource metadata, without an error code (RFC 6750 §3.1). A malformed Bearer gets `400` `invalid_request`, a token that fails verification `401` `invalid_token`, and a token without `doc_rwd` `403` `insufficient_scope`.
- Each token is introspected (RFC 7662) and exchanged (RFC 8693) for a short-lived Carbone token, the only one sent to the Carbone API: the client's own token never reaches it.
- A Bearer shaped like a Carbone API key is forwarded as is, as in API-key mode; a Carbone JWT issued through OAuth (to another client, or to a client that sent no `resource`) is refused with `401`. This is a deliberate exception to the MCP authorization specification, which forbids accepting a token not issued for this server: it keeps Carbone API keys working on the hosted server until sign-in replaces them.
- A client that never sends the RFC 8707 `resource` parameter gets a token bound to nothing, which is refused with `401`.

A client may get `429` or `503` with `Retry-After`: it retries after that delay.

Setting only some of these variables, or `CARBONE_API_KEY` with them, stops the server at startup.

| Variable | Default | Description |
|---|---|---|
| `MCP_OAUTH_ISSUER` | `https://account.carbone.io` | The authorization server, as an `https` origin without a path or trailing slash, exactly as it writes its own `issuer`: tokens are introspected at `<issuer>/api/oauth/introspect` and exchanged at `<issuer>/api/oauth/token`. |
| `MCP_OAUTH_CLIENT_ID` | none | This server's client ID, registered at the authorization server as the resource server for `MCP_RESOURCE_URL` (`client_secret_basic`). |
| `MCP_OAUTH_CLIENT_SECRET` | none | This server's client secret; never logged. |
| `MCP_RESOURCE_URL` | none | The URL MCP clients connect to, exactly as they enter it: the protected resource advertised at `/.well-known/oauth-protected-resource[/<path>]` (RFC 9728) and the audience every token must be bound to. An origin is written without a trailing slash (`https://mcp.carbone.io`); its path (`/` for an origin) must equal `MCP_PATH`. |

---

## Health endpoint

Available in HTTP mode at `GET /health`. Always returns HTTP 200 — the status code signals MCP server liveness.

```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "mcp":    { "version": "2.0.0" },
  "carbone": { "version": "5.x.x" }
}
```

The `carbone` field reflects backend connectivity:

| Value | Meaning |
|---|---|
| `{ "version": "..." }` | Reachable and authenticated |
| `{ "error": "unauthorized", "message": "..." }` | Reachable but no/invalid API key |
| `{ "error": "unreachable", "message": "..." }` | Network error, timeout, or unexpected response |
| `{ "status": "checking" }` | Right after start, until the first check completes |

---

## Supported output formats

The 36 values accepted by `convertTo`:

```
Documents:               pdf, docx, doc, odt, ott, rtf, epub
Spreadsheets:            xlsx, xls, ods, ots, csv, dbf, dif
Presentations, drawings: pptx, ppt, odp, otp, odg
Web/Text:                html, xhtml, txt, md, xml, idml
Images:                  png, jpg, jpeg, webp, gif, tiff, bmp, svg, emf, wmf, eps
```

Valid outputs depend on the input format. `doc`, `xls` and `ppt` are output-only (rejected as input). `zip` is not an output format: batch archives come from `batchOutput`.

Full conversion matrix: [carbone.io documentation](https://carbone.io/documentation/developer/http-api/generate-reports.html#output-file-type)
