# Carbone MCP Server

[![npm version](https://img.shields.io/npm/v/carbone-mcp.svg)](https://www.npmjs.com/package/carbone-mcp)
[![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0.1%2Fservers%2Fio.carbone%252Fcarbone-mcp%2Fversions%2Flatest&query=%24.server.version&label=MCP%20Registry&logo=modelcontextprotocol)](https://registry.modelcontextprotocol.io/?q=io.carbone%2Fcarbone-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> **Official Carbone MCP server** — Turn AI assistants into document automation experts. Generate professional PDFs, invoices, reports, and more using natural language.

Give Claude, ChatGPT, and other AI assistants the power to:
- 🔄 **Document Conversion** — 100+ format combinations (PDF, DOCX, XLSX, PNG, HTML, CSV…)
- 📄 **Template Engine** — Generate documents from JSON data with `{d.field}` tags
- 📚 **Template Library** — Upload, version, categorize, and manage reusable templates
- 🎨 **PDF Customization** — Fill PDF forms, add watermarks, passwords, encryption, multiple converter engines
- 🌍 **Localization** — Multi-language support, currency conversion, timezone handling
- ⚡ **Batch Generation** — Create hundreds of documents in one request (async via webhook)

---

## Installation

Get your free API key at [account.carbone.io](https://account.carbone.io).

### stdio — Claude Desktop, VS Code, Cursor, Claude Code, and more

All stdio-compatible MCP clients use the same config:

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

| Client | Config file |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor (global) | `~/.cursor/mcp.json` |
| Cursor (project) | `.cursor/mcp.json` |
| Claude Code | `claude mcp add carbone-mcp -e CARBONE_API_KEY=your_key -- npx -y carbone-mcp` |

> **VS Code** uses `{ "mcp": { "servers": { ... } } }` instead of `{ "mcpServers": { ... } }` — the inner config block is identical.

After adding the config, restart your client and try: *"What can Carbone do?"*

---

### HTTP — mcp.carbone.io (no local installation)

Connect directly to the hosted endpoint. Supported by VS Code, Cursor, Claude Code, and other clients that support streamable HTTP transport.

```json
{
  "mcp": {
    "servers": {
      "carbone": {
        "type": "streamable-http",
        "url": "https://mcp.carbone.io",
        "headers": {
          "Authorization": "Bearer your_api_key_here"
        }
      }
    }
  }
}
```

> **Authentication:** The HTTP endpoint currently requires a Carbone API key passed as a Bearer token in the `Authorization` header. OAuth2 support (for Claude Desktop, Mistral, ChatGPT, Gemini, and other clients) is planned for a future release.
>
> **Cursor** uses `{ "mcpServers": { ... } }` instead of `{ "mcp": { "servers": { ... } } }` — the inner config block is identical.
>
> **Claude Desktop** does not support HTTP Bearer token authentication — use the stdio option above instead.

---

### Docker — self-hosted HTTP server

```bash
docker run -d -p 3000:3000 \
  -e MCP_TRANSPORT=http \
  -e CARBONE_API_KEY=your_api_key_here \
  carbone/carbone-mcp
```

Connect your MCP client to `http://your-host:3000` using the HTTP config above (replace the URL).

**Docker Compose** — see [compose.yml](./compose.yml):
```bash
CARBONE_API_KEY=your_key docker compose up -d
```

**Claude Desktop with Docker (stdio)** — Claude Desktop does not support HTTP transport; use the stdio mode instead:

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

### On-Premise — self-hosted Carbone instance

If you run [Carbone on-premise](https://carbone.io/pricing.html), point the MCP server at your instance — no API key required:

```bash
# Docker (HTTP)
docker run -d -p 3000:3000 \
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
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` (default, for AI clients) or `http` (for self-hosted deployments) |
| `MCP_PORT` | `3000` | HTTP server port (only used when `MCP_TRANSPORT=http`) |
| `MCP_PATH` | `/` | HTTP endpoint path (only used when `MCP_TRANSPORT=http`) |
| `MCP_MAX_BODY_BYTES` | `62914560` | Maximum request body size in bytes (60 MB default, matching Carbone Cloud limit) |
| `CARBONE_REQUIRE_CLIENT_AUTH_HEADER` | `false` | HTTP mode only — reject requests without a Bearer key instead of falling back to the server-level `CARBONE_API_KEY` (multi-tenant safety) |

</details>

---

## Available Tools

### Document Operations

| Tool | Description | Docs |
|---|---|---|
| `convert_document` | Convert documents between 100+ formats without storing a template | [→](https://carbone.io/documentation/developer/http-api/convert-reports.html) |
| `render_document` | Generate documents from templates by merging with JSON data | [→](https://carbone.io/documentation/developer/http-api/generate-reports.html) |

### Template Management

| Tool | Description | Docs |
|---|---|---|
| `list_templates` | Browse your template library with filtering by category or search (tags are returned per template but not filterable server-side) | [→](https://carbone.io/documentation/developer/http-api/manage-templates.html#list-templates) |
| `list_categories` | List all template categories in your account | [→](https://carbone.io/documentation/developer/http-api/manage-templates.html#list-categories) |
| `list_tags` | List all tags used across your templates | [→](https://carbone.io/documentation/developer/http-api/manage-templates.html#list-tags) |
| `upload_template` | Store reusable templates with versioning, categorization, and metadata | [→](https://carbone.io/documentation/developer/http-api/manage-templates.html#upload-a-template) |
| `update_template_metadata` | Rename, categorize, tag, deploy, or expire template versions | [→](https://carbone.io/documentation/developer/http-api/manage-templates.html#patch-a-template) |
| `delete_template` | Soft-delete templates (marked for removal, gone after ~24h) | [→](https://carbone.io/documentation/developer/http-api/manage-templates.html#delete-a-template) |
| `download_template` | Download original template files (DOCX, XLSX, PDF, etc.) | [→](https://carbone.io/documentation/developer/http-api/manage-templates.html#download-a-template) |

### Discovery

| Tool | Description | Docs |
|---|---|---|
| `get_api_status` | Check Carbone API health and current version | |
| `get_capabilities` | View all supported formats, features, and examples | |

📖 **[Full API Reference →](./docs/API.md)** — Detailed parameters, schemas, and examples

---

## Output & File Delivery

By default, a generated or converted file is returned based on its type and transport:

| Output | stdio (local clients) | HTTP (remote / self-hosted) |
|---|---|---|
| Text — HTML, TXT, CSV, MD, XML | inline text | inline text |
| Inline images — PNG, JPG, GIF, WEBP | inline image | inline image |
| Everything else — PDF, Office, ZIP, SVG… | saved to a temp file, path returned | returned as a download attachment |

Three optional parameters on `convert_document` and `render_document` (and `outputPath` / `asAttachment` on `download_template`) override this:

| Parameter | Effect |
|---|---|
| `outputPath` | **stdio only** — save the output to this local path instead of returning it inline (rejected in HTTP mode) |
| `asAttachment` | return the bytes as a downloadable attachment for any format, instead of inline |
| `returnLink` | return Carbone's public **one-time** download URL instead of the file — short-lived and consumed by the first download, so hand it to the user rather than fetching it yourself (works in stdio and HTTP) |

> **Claude Desktop:** it cannot render inline binary attachments (it mishandles them as images). For PDFs and Office files, rely on the default stdio temp-file path, or use **`returnLink`** to get a download URL.

---

## Common Use Cases

### 📄 Document Conversion
```
"Convert this Word document to PDF: /path/to/contract.docx"
"Turn my Excel spreadsheet into CSV format"
"Convert this HTML page to a PNG image"
"Convert my Markdown README to PDF"
"Convert this PPTX to PNG — use OnlyOffice for best fidelity"
"Extract text from this PDF by converting it to TXT"
```

### 💼 Finance & Invoicing
```
"Generate an invoice using template T123 with: {customer: 'Acme Corp', total: 1500, items: [...]}"
"Create 500 invoices from my billing data and bundle them in a ZIP"
"Generate a French invoice for my Paris client — use EUR currency and fr-fr locale"
"Render this monthly report for each client in clients.json and ZIP them all"
"Generate invoice-{d.id}.pdf for each row in my sales data"
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
"Generate an employment contract for each person in new-hires.json"
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
"Convert each slide of this PPTX to a separate PDF page"
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

## Debugging

### Using MCP Inspector

Test and debug the server interactively:

```bash
npx @modelcontextprotocol/inspector npx carbone-mcp
```

Or from a local build:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Open `http://localhost:5173` to view all tools, test calls, and inspect request/response JSON — no AI inference needed.

### View Server Logs

```bash
# macOS — Claude Desktop logs
tail -f ~/Library/Logs/Claude/mcp*.log

# Windows
Get-Content "$env:APPDATA\Claude\logs\mcp*.log" -Wait -Tail 50
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
  "mcp":    { "version": "1.2.2" },
  "carbone": { "version": "5.x.x" }
}
```

The `carbone` field shows backend connectivity:
- `{ "version": "..." }` — reachable and authenticated
- `{ "error": "unauthorized", "message": "..." }` — reachable but no/invalid API key
- `{ "error": "unreachable", "message": "..." }` — network error, timeout, or unexpected response

---

## Security

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

Your invoice total is {d.total:formatC(EUR)}.

Items:
{d.items[i].description}  {d.items[i].quantity}x  {d.items[i].price:formatC(EUR)}
{d.items[i+1]}
```

**Guides & best practices:**
- [Carbone Skill](https://carbone.io/documentation/developer/ai/skills.html) — Universal Carbone Templating syntax reference for AI tools ([download .skill](https://github.com/carboneio/carbone-skill/releases/latest/download/carbone.skill) · [GitHub](https://github.com/carboneio/carbone-skill))
- [Template syntax](https://carbone.io/documentation/developer/introduction.html)
- [HTML templates guide](https://carbone.io/documentation/design/template-formats/html.html)
- [Markdown templates guide](https://carbone.io/documentation/design/template-formats/markdown.html)

---

## Supported Output Formats

| Category | Formats |
|---|---|
| Documents | PDF, DOCX, XLSX, PPTX, ODT, ODS, ODP, ODG, RTF, EPUB |
| Images | PNG, JPG, WEBP, SVG, TIFF, BMP, GIF |
| Web / Text | HTML, TXT, CSV, MD, XML |

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

```bash
npm run dev          # Run with tsx (no build needed)
npm run build        # Compile TypeScript → dist/
npm test             # Run the test suite (integration tests run only with CARBONE_TEST_API_KEY)
npm run test:watch   # Watch mode
npm run test:integration  # Real API tests (requires CARBONE_TEST_API_KEY)
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
