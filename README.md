# Carbone MCP Server

[![npm version](https://img.shields.io/npm/v/carbone-mcp.svg)](https://www.npmjs.com/package/carbone-mcp)
[![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0.1%2Fservers%2Fio.carbone%252Fcarbone-mcp%2Fversions%2Flatest&query=%24.server.version&label=MCP%20Registry&logo=modelcontextprotocol)](https://registry.modelcontextprotocol.io/?q=io.carbone%2Fcarbone-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> **Official Carbone MCP server** — Turn AI assistants into document automation experts. Generate professional PDFs, invoices, reports, and more using natural language.

Give Claude, ChatGPT, and other AI assistants the power to:
- 🔄 **Document Conversion** — 100+ format combinations (PDF, DOCX, XLSX, PNG, HTML, CSV…)
- 📄 **Template Engine** — Generate documents from JSON data with `{d.field}` tags
- 🔍 **Template Inspection** — List the tags a template uses and get a sample JSON dataset to fill it
- 📚 **Template Library** — Upload, version, categorize, and manage reusable templates
- 🎨 **PDF Customization** — Fill PDF forms, add watermarks, passwords, encryption, multiple converter engines (LibreOffice, OnlyOffice, Chromium, Carbone ICE)
- 🌍 **Localization** — Multi-language support, currency conversion, timezone handling
- ⚡ **Batch Generation** — Create up to 100 documents per request on Carbone Cloud (async, delivered to your webhook)

---

## Installation

The server supports MCP protocol 2026-07-28 and still serves clients on the earlier 2025-era protocol, over both stdio and HTTP.

### Prerequisites

- **A Carbone API key** from [account.carbone.io](https://account.carbone.io). Your account has two keys ([details](https://carbone.io/documentation/developer/http-api/introduction.html#requirements)):
  - **Test key** — free and unlimited, but produces **PDF only, with a watermark**. Templates uploaded with it are deleted automatically within 30 days.
  - **Production key** — any output format, no watermark. The free Sandbox plan includes 100 credits per month.
- **Node.js 20.3 or later** for the local package (`npx carbone-mcp`). Check with `node --version`. The Docker image needs Docker only.

### Choose a setup

| Setup | Runs | Clients | Local files |
|---|---|---|---|
| [Local package (stdio)](#local-package-stdio) | `npx carbone-mcp` on your machine | Claude Desktop, Claude Code, VS Code, Cursor, and any client that starts local servers | ✅ reads local paths, saves documents to disk |
| [Hosted server (HTTP)](#hosted-server-mcpcarboneio) | `https://mcp.carbone.io`, nothing to install | Clients that can send an `Authorization` header: Claude Code, VS Code, Cursor, … | ❌ URLs and base64 only |
| [Docker (HTTP)](#docker--self-hosted-http-server) | Your own server | Same as the hosted server | ❌ URLs and base64 only |

**Claude Desktop:** use the local package. **claude.ai** on the web reaches remote servers only, as connectors: see [claude.ai and Claude Desktop connectors](#claudeai-and-claude-desktop-connectors).

---

### Local package (stdio)

Most clients use this config:

```json
{
  "mcpServers": {
    "carbone": {
      "command": "npx",
      "args": ["-y", "carbone-mcp"],
      "env": {
        "CARBONE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

| Client | Where to put it |
|---|---|
| Claude Desktop | **Settings → Developer → Edit Config** opens `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`). Quit and restart Claude Desktop afterwards. |
| Cursor | `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project) |

**Claude Code:**

```bash
claude mcp add --env CARBONE_API_KEY=your_api_key_here --transport stdio carbone -- npx -y carbone-mcp
```

**VS Code** — `.vscode/mcp.json` uses `servers`, not `mcpServers`. With an input variable, VS Code asks for the key once and stores it securely:

```json
{
  "inputs": [
    { "type": "promptString", "id": "carbone-api-key", "description": "Carbone API key", "password": true }
  ],
  "servers": {
    "carbone": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "carbone-mcp"],
      "env": { "CARBONE_API_KEY": "${input:carbone-api-key}" }
    }
  }
}
```

Then try: *"What can Carbone do?"*

Client docs: [Claude Desktop](https://modelcontextprotocol.io/docs/develop/connect-local-servers) · [Claude Code](https://code.claude.com/docs/en/mcp) · [VS Code](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration) · [Cursor](https://cursor.com/docs/context/mcp)

---

### Hosted server (mcp.carbone.io)

Connect to `https://mcp.carbone.io` over Streamable HTTP, and send your Carbone API key in the header `Authorization: Bearer <your API key>`. OAuth is not available yet.

**Claude Code:**

```bash
claude mcp add --transport http carbone https://mcp.carbone.io --header "Authorization: Bearer your_api_key_here"
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "inputs": [
    { "type": "promptString", "id": "carbone-api-key", "description": "Carbone API key", "password": true }
  ],
  "servers": {
    "carbone": {
      "type": "http",
      "url": "https://mcp.carbone.io",
      "headers": { "Authorization": "Bearer ${input:carbone-api-key}" }
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json` or `.cursor/mcp.json`). Cursor also accepts `"Bearer ${env:CARBONE_API_KEY}"` to read the key from an environment variable:

```json
{
  "mcpServers": {
    "carbone": {
      "url": "https://mcp.carbone.io",
      "headers": { "Authorization": "Bearer your_api_key_here" }
    }
  }
}
```

Over HTTP, file inputs must be URLs or base64: the server cannot read your local files (see [File inputs](#file-inputs)).

---

### claude.ai and Claude Desktop connectors

**Recommended: Claude Desktop with the [local package](#local-package-stdio).** claude.ai on the web cannot start local servers.

Remote servers are added to claude.ai and Claude Desktop as *custom connectors*. Per [Anthropic's documentation](https://claude.com/docs/connectors/building/authentication), a custom connector authenticates with OAuth or connects without authentication. A fixed API key sent in a request header is a **beta available to a limited set of organizations**: an organization Owner enters it once, and Claude sends it for **every member** of the organization.

`mcp.carbone.io` authenticates with `Authorization: Bearer <Carbone API key>` and does not offer OAuth yet, so use it as a connector only if your organization has the **Request headers** section ([setup](https://claude.com/docs/connectors/custom/add-unlisted#authenticate-with-request-headers)):

1. Add a custom connector with the URL `https://mcp.carbone.io` and the authentication **No sign-in**.
2. Under **Request headers**, choose `authorization` and enter `Bearer <your Carbone API key>`, including `Bearer ` and the space.

Everyone in the organization then shares that key, and every document counts against that one Carbone account: use a dedicated key.

---

### Docker — self-hosted HTTP server

The image runs in HTTP mode by default (`MCP_TRANSPORT=http`, port 3000). This quick start sets **no server key**: each client sends its own key in `Authorization: Bearer <key>`, exactly as with mcp.carbone.io, and the port is reachable from your machine only.

```bash
docker run -d --name carbone-mcp -p 127.0.0.1:3000:3000 carbone/carbone-mcp
curl http://localhost:3000/health
```

Connect your client with the [hosted server config](#hosted-server-mcpcarboneio), replacing `https://mcp.carbone.io` with `http://localhost:3000`.

**Serving other machines:** publish the port behind a TLS reverse proxy, keep the server without `CARBONE_API_KEY` (or set `CARBONE_REQUIRE_CLIENT_AUTH_HEADER=true`), and list the hostnames of browser-based clients in `MCP_ALLOWED_ORIGINS`.

**Shared-key variant — one user, local only.** A server-level key lets clients connect without sending one:

```bash
docker run -d --name carbone-mcp -p 127.0.0.1:3000:3000 -e CARBONE_API_KEY=your_api_key_here carbone/carbone-mcp
```

> ⚠️ Every request without a Bearer key then spends **your** key: anyone who can reach the port uses your Carbone account. The server prints a warning at startup. Never publish this port on a network you don't fully trust. See [Security](#security).

**Docker Compose** — [compose.yml](./compose.yml) builds the image from this repository, binds `127.0.0.1` only, sets no server key, and passes through every variable of [.env.example](./.env.example):

```bash
docker compose up -d
```

`docker compose` also reads `CARBONE_API_KEY` from your shell or a `.env` file: if it is set there, you get the shared-key variant.

**Claude Desktop with Docker (stdio):**

```json
{
  "mcpServers": {
    "carbone": {
      "command": "docker",
      "args": ["run", "-i", "--rm",
               "-e", "CARBONE_API_KEY=your_api_key_here",
               "-e", "MCP_TRANSPORT=stdio",
               "carbone/carbone-mcp"]
    }
  }
}
```

In this mode, local paths and saved documents refer to the **container's** filesystem, which `--rm` deletes. Pass URLs or base64 and ask for `returnLink`, or mount a folder with `-v` and use paths inside it.

### On-Premise — self-hosted Carbone instance

If you run [Carbone on-premise](https://carbone.io/pricing.html), point the MCP server at your instance — no API key required:

```bash
# Docker (HTTP)
docker run -d -p 127.0.0.1:3000:3000 \
  -e CARBONE_BASE_URL=https://your-carbone-server.com \
  carbone/carbone-mcp

# stdio
CARBONE_BASE_URL=https://your-carbone-server.com npx carbone-mcp
```

---

## Environment Variables

**Required (stdio mode, cloud API):**
- `CARBONE_API_KEY` — Your Carbone API key ([get one free →](https://account.carbone.io)). Not required when `CARBONE_BASE_URL` points to your own on-premise server, or when running in HTTP mode (clients supply their own key via `Authorization: Bearer`).

<details>
<summary>Optional configuration</summary>

| Variable | Default | Description |
|---|---|---|
| `CARBONE_BASE_URL` | `https://api.carbone.io` | Override for self-hosted or staging environments. When set to a custom URL, `CARBONE_API_KEY` is not required. |
| `CARBONE_TIMEOUT` | `60000` | Request timeout in milliseconds (max: 60000) |
| `CARBONE_MAX_FILE_BYTES` | `104857600` | Maximum size (bytes) for a resolved input file — path, URL, or base64 (100 MB default) |
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` (default, for AI clients) or `http` (for self-hosted deployments; the Docker image default) |
| `MCP_PORT` | `3000` | HTTP server port (only used when `MCP_TRANSPORT=http`) |
| `MCP_PATH` | `/` | HTTP endpoint path (only used when `MCP_TRANSPORT=http`). Cannot be `/health` |
| `MCP_MAX_BODY_BYTES` | `62914560` | Maximum size in bytes of one incoming MCP message — an HTTP request body (`413` when exceeded) or one stdio message (60 MB default, matching Carbone Cloud limit) |
| `MCP_ALLOWED_ORIGINS` | `localhost`, `127.0.0.1`, `[::1]` | HTTP mode only — browser `Origin` hostnames allowed in addition to the localhost default: comma-separated, without scheme or port (e.g. `app.example.com`); `<scheme>://*` allows a browser-extension scheme (e.g. `moz-extension://*`). A request whose `Origin` is present but not allowed gets `403`; requests without an `Origin` (desktop, CLI, server-side clients) are unaffected. Invalid entries stop the server at startup |
| `CARBONE_REQUIRE_CLIENT_AUTH_HEADER` | `false` | HTTP mode only — require `Authorization: Bearer <key>` on every request. **Leave `false` only if you intend a shared-key server:** with a server-level `CARBONE_API_KEY` set, requests that carry no Bearer key fall back to it, so anyone who can reach the port can spend that Carbone account. Set to `true` to require each client to bring its own key. Irrelevant when no server key is set (e.g. on-premise) |
| `CARBONE_ALLOW_PRIVATE_NETWORK` | `false` | Allow user-supplied URLs (templates, `data`, …) to resolve to private/internal addresses. Off by default to block SSRF (cloud metadata, `localhost`, RFC1918). Enable only on a trusted deployment with internal template hosts |

</details>

---

## Available Tools

### Document Operations

| Tool | Description | Docs |
|---|---|---|
| `convert_document` | Convert documents between 100+ formats without storing a template (pure conversion: tags are kept) | [→](https://carbone.io/documentation/developer/http-api/convert-reports.html) |
| `render_document` | Generate documents from templates by merging with JSON data | [→](https://carbone.io/documentation/developer/http-api/generate-reports.html) |

### Template Management

| Tool | Description | Docs |
|---|---|---|
| `inspect_template` | List the Carbone tags a template uses and return a sample JSON dataset matching its structure — call it before `render_document` when you don't know which data a template expects. Runs one render on your account (counted like a document generation) and discards the document | |
| `list_templates` | Browse your template library with filtering by category or search (tags are returned per template but not filterable server-side) | [→](https://carbone.io/documentation/developer/http-api/manage-templates.html#list-templates) |
| `list_categories` | List all template categories in your account | [→](https://carbone.io/documentation/developer/http-api/manage-templates.html#list-categories) |
| `list_tags` | List all tags used across your templates | [→](https://carbone.io/documentation/developer/http-api/manage-templates.html#list-tags) |
| `upload_template` | Store reusable templates with versioning, categorization, and metadata | [→](https://carbone.io/documentation/developer/http-api/manage-templates.html#upload-a-template) |
| `update_template_metadata` | Rename, categorize, tag, deploy, or expire template versions | [→](https://carbone.io/documentation/developer/http-api/manage-templates.html#patch-a-template) |
| `delete_template` | Delete templates — takes effect immediately (the file is purged after the retention delay) | [→](https://carbone.io/documentation/developer/http-api/manage-templates.html#delete-a-template) |
| `download_template` | Download original template files (DOCX, XLSX, PDF, etc.) | [→](https://carbone.io/documentation/developer/http-api/manage-templates.html#download-a-template) |

### Discovery

| Tool | Description | Docs |
|---|---|---|
| `get_api_status` | Check Carbone API health and current version | |
| `get_capabilities` | View all supported formats, features, and examples | |

📖 **[Full API Reference →](./docs/API.md)** — Detailed parameters, schemas, and examples

---

## File inputs

`file` (`convert_document`) and `template` (`render_document`, `inspect_template`, `upload_template`) accept:

| Form | Example | stdio | HTTP |
|---|---|---|---|
| Absolute local path | `/Users/me/invoice.docx`, `~/invoice.docx`, `C:\Users\me\invoice.docx` | ✅ | ❌ refused |
| URL | `https://example.com/invoice.docx` | ✅ | ✅ |
| Base64 | the file content, base64-encoded | ✅ | ✅ |

Any other string, such as a bare `invoice.docx`, is read as base64 and fails. Relative paths (`./…`, `../…`) resolve against the server's working directory, which your client chooses: prefer absolute paths. The JSON parameters (`data`, `complement`, …) also accept a path, URL or base64 string pointing to a JSON file ([details](./docs/API.md#pass-json-by-reference)).

---

## Output & File Delivery

By default, a generated or converted file is returned based on its type and transport:

| Output | stdio (local clients) | HTTP (remote / self-hosted) |
|---|---|---|
| Text — HTML, TXT, CSV, MD, XML, JSON (template samples) | inline text | inline text |
| Inline images — PNG, JPG, GIF, WEBP | inline image | inline image |
| Everything else — PDF, Office, SVG, TIFF… | saved to a temp file, path returned | returned as a download attachment |

Three optional parameters on `convert_document` and `render_document` (and `outputPath` / `asAttachment` on `download_template`) override this:

| Parameter | Effect |
|---|---|
| `outputPath` | **stdio only** — save the output to this local path instead of returning it inline (rejected in HTTP mode). The file must not exist yet — an existing file or symlink is never overwritten — and is created readable by you only |
| `asAttachment` | return the bytes as a downloadable attachment for any format, instead of inline |
| `returnLink` | return Carbone's public **one-time** download URL instead of the file — short-lived and consumed by the first download, so hand it to the user rather than fetching it yourself (works in stdio and HTTP) |

> **Claude Desktop:** it cannot render inline binary attachments (it mishandles them as images). For PDFs and Office files, rely on the default stdio temp-file path, or use **`returnLink`** to get a download URL.

---

## Common Use Cases

### 📄 Document Conversion
```
"Convert this Word document to PDF: /Users/me/contracts/contract.docx"
"Turn my Excel spreadsheet into CSV format"
"Convert this HTML page to a PNG image"
"Convert my Markdown README to PDF"
"Convert this DOCX to PDF with the Carbone ICE converter — the fastest for Word files"
"Render this PDF as a PNG thumbnail"
```

### 🔍 Template Inspection
```
"Which data does template 1530905183164918624 expect? Show me a sample JSON"
"List the Carbone tags used in /Users/me/templates/invoice.docx"
"Inspect https://example.com/offer-letter.docx, then render it with the data in ~/data/candidate.json"
```

### 💼 Finance & Invoicing
```
"Generate an invoice using template T123 with: {customer: 'Acme Corp', total: 1500, items: [...]}"
"Generate invoices from the data in /data/invoices.json"
"Create 100 invoices from my billing data as one ZIP, delivered to my webhook https://example.com/hook"
"Generate a French invoice for my Paris client — use EUR currency and fr-fr locale"
"Render this monthly report for each client in ~/data/clients.json as one merged PDF, sent to my webhook"
"Generate one invoice per row in my sales data, named invoice-{d.id}"
```

### ⚖️ Legal & Compliance
```
"Add a CONFIDENTIAL watermark to this contract before sending it"
"Convert this NDA to PDF/A format for long-term archiving"
"Generate a password-protected PDF — open password: 'secret123'"
"Create signed offer letters for each candidate using this DOCX template"
"Generate a compliance report with a DRAFT watermark, 20% opacity, rotated -45°"
```

### 👥 HR & People Operations
```
"Create personalized onboarding documents for all 50 new employees in this JSON"
"Generate an employment contract for each person in ~/hr/new-hires.json"
"Build payslips for every employee in my payroll export"
"Create training certificates for everyone who passed this month"
"Fill out the performance review template with each employee's data"
```

### 🌍 Localization & Multi-Language
```
"Generate this invoice in French, German, and Spanish from the same template"
"Render the report with timezone America/New_York so dates show in Eastern time"
"Convert all prices from EUR to USD using today's exchange rates"
"Generate the contract in fr-fr locale so numbers use European formatting"
```

### 🔐 PDF Security & Advanced Options
```
"Convert this DOCX to a password-protected PDF"
"Add a semi-transparent DRAFT watermark to every page"
"Generate a PDF/A-1b compliant version of this document for archiving"
"Export only pages 1–5 of this presentation as a PDF"
"Make this PDF accessible: tagged PDF with PDF/UA compliance"
```

### 📚 Template Management
```
"Upload this invoice template and tag it 'sales' and 'finance'"
"What templates do I have in the 'contracts' category?"
"Show me all templates tagged 'hr'"
"Download template T456 so I can edit it locally"
"Deploy version V789 as the active version without deleting the others"
"Schedule this old template for deletion in 30 days"
```

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Tool error `Authentication failed: …` (no key, or a key the Carbone API rejects with `401`) | **stdio:** set `CARBONE_API_KEY` in the client config's `env` and restart the client (without it, the server stops at startup with `CARBONE_API_KEY environment variable is required`). **HTTP:** send `Authorization: Bearer <key>`; a server with `CARBONE_REQUIRE_CLIENT_AUTH_HEADER=true` requires it on every request. Check the key at [account.carbone.io](https://account.carbone.io). |
| HTTP `403` `Invalid Origin: <host>` | A browser-based client served from a host other than `localhost`. Add its hostname to `MCP_ALLOWED_ORIGINS`. |
| HTTP `405` `Method not allowed` when you open the endpoint in a browser | Expected: the endpoint only answers MCP `POST` requests. Connect with an MCP client; check the server with `GET /health`. |
| HTTP `413` `Request body too large`, or the stdio connection closes | One MCP message is over `MCP_MAX_BODY_BYTES` (60 MB by default; it applies to stdio messages too). Pass large files by URL (or a local path in stdio) instead of inline base64, or raise the limit. |
| `Rate limit exceeded. Please wait N second(s)` | The Carbone API answered `429`. Wait the time given and try again. |
| Tags such as `{d.name}` still visible in the output | `convert_document` is a pure conversion and keeps tags. Use `render_document` with your data. |
| Watermark on every PDF, or only PDF works | You use the **test** API key: it produces watermarked PDFs only. Use the production key. |
| A file given by name (`invoice.docx`) fails | A bare name is read as base64. Pass an absolute path (stdio), a URL, or base64 ([File inputs](#file-inputs)). |
| Rendering by Template ID still uses the old version after an upload | Renders by Template ID use the **deployed** version (most recent `deployedAt`). Deploy the new version with `update_template_metadata` (`templateId` = its Version ID, `deployedAt` = `42000000000`), or render by Version ID. |
| Password, watermark or PDF/A not applied when converting an existing PDF to PDF | Fixed in 2.0.0: the server sets `hardRefresh` automatically for PDF → PDF with `formatOptions`. On 1.x, pass `hardRefresh: true`. |

---

## Debugging

### Using MCP Inspector

Test and debug the server interactively with the [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) (requires Node.js 22.19 or later):

```bash
npx @modelcontextprotocol/inspector -e CARBONE_API_KEY=your_api_key_here npx carbone-mcp
```

From a local build:

```bash
npx @modelcontextprotocol/inspector -e CARBONE_API_KEY=your_api_key_here node dist/index.js
```

A running HTTP server:

```bash
npx @modelcontextprotocol/inspector --server-url http://localhost:3000 --transport http --header "Authorization: Bearer your_api_key_here"
```

The Inspector opens its web UI in your browser (port `6274` by default; the printed URL carries a per-launch session token). Use it to list the tools, test calls, and inspect request/response JSON — no AI inference needed.

### View Server Logs

Claude Desktop writes `mcp.log` and one `mcp-server-<name>.log` per server (here `mcp-server-carbone.log`, the server's stderr):

```bash
# macOS
tail -n 20 -f ~/Library/Logs/Claude/mcp*.log

# Windows (cmd)
type "%APPDATA%\Claude\logs\mcp*.log"
```

**Look for:**
- ✅ `Carbone MCP Server v1.x.x started (stdio)`
- ❌ Any error messages or stack traces

### Health Check (HTTP mode only)

When running in HTTP mode, the server exposes a health endpoint:

```bash
curl http://localhost:3000/health
```

```json
{
  "mcp":    { "version": "1.x.x" },
  "carbone": { "version": "5.x.x" }
}
```

The `carbone` field shows backend connectivity:
- `{ "version": "..." }` — reachable and authenticated
- `{ "error": "unauthorized", "message": "..." }` — reachable but no/invalid API key
- `{ "error": "unreachable", "message": "..." }` — network error, timeout, or unexpected response

---

## Security

⚠️ **File and URL inputs (SSRF / local files)**
Tools accept a local path, an HTTPS URL, or base64 for `file` / `template` and the by-reference JSON params (`data`, `complement`, …). Two guards apply:
- **URLs** are resolved and refused when they point at loopback, private (RFC1918), link-local (incl. cloud metadata `169.254.169.254`), CGNAT or reserved addresses, in any IPv4 or IPv6 notation (including IPv4 addresses embedded in IPv6). The check applies to the address actually connected to, so a DNS answer cannot change between check and connection, and every redirect hop is re-checked. In HTTP mode nothing is downloaded for a request that carries no API key (unless the server is set up to call Carbone without one). Set `CARBONE_ALLOW_PRIVATE_NETWORK=true` only on a trusted deployment that needs internal template hosts.
- **Local paths** are readable in **stdio only**, where the server already runs as you. In HTTP mode they are refused, so a remote caller can never make the server read its own filesystem.

⚠️ **Sharing a server-level API key (HTTP mode)**
If you set `CARBONE_API_KEY` on an HTTP server and leave `CARBONE_REQUIRE_CLIENT_AUTH_HEADER=false` (the default), requests without a Bearer key fall back to that key — anyone who can reach the port can spend that Carbone account. The server prints a warning at startup in that configuration. The [Docker quick start](#docker--self-hosted-http-server) therefore sets no server key and binds `127.0.0.1`. Set `CARBONE_REQUIRE_CLIENT_AUTH_HEADER=true` to require each client to bring its own key, or only expose the port on a trusted network. (Not applicable when no server key is set, e.g. on-premise Carbone without authentication.)

⚠️ **Browser origins and DNS rebinding (HTTP mode)**
The MCP endpoint answers `403` when a request's `Origin` header is present but not allowed, so a malicious web page cannot reach a locally running server (e.g. through DNS rebinding) and spend its key. `localhost`, `127.0.0.1` and `[::1]` are allowed by default; list the hostnames of browser-based clients you trust in `MCP_ALLOWED_ORIGINS`. Requests without an `Origin` header (desktop, CLI and server-side clients) are unaffected.

⚠️ **Prompt Injection**
Connecting an AI assistant to any external service carries inherent risks. A malicious document or template could contain instructions that trick the AI into performing unintended actions (e.g. exfiltrating data, deleting templates). Always review what your AI client is about to do before confirming tool calls.

⚠️ **API Key Protection**
- Never commit `CARBONE_API_KEY` to version control
- Use environment variables or a secret manager
- Rotate API keys regularly at [account.carbone.io](https://account.carbone.io)

⚠️ **Template Safety**
- Only upload templates from trusted sources
- Review templates before deploying them
- Use template versioning for easy rollback

⚠️ **Data Privacy**
- Carbone does not store your document data after rendering
- Use `CARBONE_BASE_URL` to point to a self-hosted instance for maximum control
- See [Privacy Policy](https://carbone.io/company/privacy-policy.html) for details

---

## Template Syntax

Design templates in Word, Excel, LibreOffice, or HTML with `{d.field}` tags:

```
Dear {d.customer.name},

Your invoice total is {d.total:formatC()}.

Items:
{d.items[i].description}  {d.items[i].quantity}x  {d.items[i].price:formatC()}
{d.items[i+1]}
```

`{d.items[i]}` … `{d.items[i+1]}` repeats a line for each item ([loops](https://carbone.io/documentation/design/repetitions/with-arrays.html)). `:formatC()` formats an amount in the currency and locale of the render: with `lang: "fr-fr"`, `currencySource: "EUR"` and `currencyTarget: "EUR"`, `1000.456` prints as `1 000,46 €` ([currency formatters](https://carbone.io/documentation/design/formatters/currency.html)).

**Guides & best practices:**
- [Carbone Skill](https://carbone.io/documentation/developer/ai/skills.html) — Universal Carbone Templating syntax reference for AI tools ([download .skill](https://github.com/carboneio/carbone-skill/releases/latest/download/carbone.skill) · [GitHub](https://github.com/carboneio/carbone-skill))
- [Template syntax: the basics](https://carbone.io/documentation/design/substitutions/the-basics.html)
- [HTML templates guide](https://carbone.io/documentation/design/template-formats/html.html)
- [Markdown templates guide](https://carbone.io/documentation/design/template-formats/markdown.html)

---

## Supported Output Formats

| Category | Formats |
|---|---|
| Documents | PDF, DOCX, DOC, ODT, OTT, RTF, EPUB |
| Spreadsheets | XLSX, XLS, ODS, OTS, CSV, DBF, DIF |
| Presentations & drawings | PPTX, PPT, ODP, OTP, ODG |
| Web / Text | HTML, XHTML, TXT, MD, XML, IDML |
| Images | PNG, JPG / JPEG, WEBP, GIF, TIFF, BMP, SVG, EMF, WMF, EPS |

Valid outputs depend on the input format. DOC, XLS and PPT are output-only: Carbone reads XML-based and text-based documents (plus PDF), so re-save a legacy binary Office file as DOCX, XLSX or PPTX before converting or rendering it.

Full conversion matrix: [carbone.io/documentation](https://carbone.io/documentation/developer/http-api/generate-reports.html#output-file-type)

---

## Contributing

We welcome contributions:

- 🐛 **Report bugs** via [GitHub Issues](https://github.com/carboneio/carbone-mcp/issues)
- 💡 **Request features** or suggest improvements
- 📝 **Improve documentation**
- 🧪 **Add tests** to increase coverage
- 🔧 **Submit pull requests** with bug fixes or enhancements

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Development

Requires Node.js 20.3 or later.

```bash
npm run dev          # Run with tsx (no build needed)
npm run build        # Compile TypeScript → dist/
npm test             # Run the test suite (the real-API e2e tests run only with CARBONE_TEST_API_KEY)
npm run test:watch   # Watch mode
npm run test:integration  # Integration tests (e2e against the real API needs CARBONE_TEST_API_KEY)
npm run test:coverage     # Coverage report
```

---

## Support

- 🤖 **MCP Documentation:** [carbone.io/documentation/developer/ai/mcp.html](https://carbone.io/documentation/developer/ai/mcp.html)
- 📚 **API Documentation:** [carbone.io/documentation/developer/http-api/introduction.html](https://carbone.io/documentation/developer/http-api/introduction.html)
- 📚 **Templating Documentation:** [carbone.io/documentation/design/overview/getting-started.html](https://carbone.io/documentation/design/overview/getting-started.html)
- 🐛 **Bug Reports:** [GitHub Issues](https://github.com/carboneio/carbone-mcp/issues)
- 💬 **Live Chat:** [carbone.io](https://carbone.io) (bottom-right widget)
- 📧 **Enterprise:** contact@carbone.io
- 📋 **OpenAPI specification:** [carbone.OpenAPI.yml](https://carbone.io/file/carbone.OpenAPI.yml)

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
