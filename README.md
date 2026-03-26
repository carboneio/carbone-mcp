# Carbone MCP Server

[![npm version](https://img.shields.io/npm/v/carbone-mcp.svg)](https://www.npmjs.com/package/carbone-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)

> **Official Carbone MCP server** — Turn AI assistants into document automation experts. Generate professional PDFs, invoices, reports, and more using natural language.

Give Claude, ChatGPT, and other AI assistants the power to:
- Convert between 100+ document formats instantly
- Generate documents from templates with JSON data
- Manage template libraries with versioning
- Fill PDF forms programmatically
- Create batch documents (invoices, certificates, letters)

---

## Features

- 🔄 **Document Conversion** — 100+ format combinations (PDF, DOCX, XLSX, PNG, HTML, CSV…)
- 📄 **Template Engine** — Generate documents from JSON data with `{d.field}` tags
- 📚 **Template Library** — Upload, version, categorize, and manage reusable templates
- 🎨 **PDF Customization** — Watermarks, passwords, encryption, multiple converter engines
- 🌍 **Localization** — Multi-language support, currency conversion, timezone handling
- ⚡ **Batch Generation** — Create hundreds of documents in one request

---

## Requirements

- **Node.js 18+** (Node 24 recommended)
- A **Carbone API key** — get one free at [account.carbone.io](https://account.carbone.io)

---

## Quick Start

### Option 1: Using npx (Recommended — No Installation)

```bash
export CARBONE_API_KEY=your_api_key_here
npx -y carbone-mcp
```

### Option 2: Building from Source

<details>
<summary>Show build instructions</summary>

```bash
git clone https://github.com/carboneio/carbone-mcp
cd carbone-mcp
npm install && npm run build
CARBONE_API_KEY=your_key node dist/index.js
```

</details>

---

## Installation

### Claude Desktop

**1. Edit the config file**

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

<details>
<summary>Alternative: local build config</summary>

```json
{
  "mcpServers": {
    "carbone": {
      "command": "/path/to/node",
      "args": ["/absolute/path/to/carbone-mcp/dist/index.js"],
      "env": {
        "CARBONE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

</details>

**2. Restart Claude Desktop**

Try asking: *"What can Carbone do?"* or *"Convert this file to PDF: /path/to/document.docx"*

---

### VS Code (Cline / Copilot)

Add to your VS Code settings or create `.vscode/mcp.json`:

```json
{
  "mcp": {
    "servers": {
      "carbone": {
        "command": "npx",
        "args": ["-y", "carbone-mcp"],
        "env": {
          "CARBONE_API_KEY": "your_api_key_here"
        }
      }
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

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

---

### Remote HTTP (mcp.carbone.io)

Connect directly to the hosted Carbone MCP endpoint — no local installation needed.

**Claude Desktop:**
```json
{
  "mcpServers": {
    "carbone": {
      "type": "streamable-http",
      "url": "https://mcp.carbone.io",
      "headers": {
        "Authorization": "Bearer your_api_key_here"
      }
    }
  }
}
```

**VS Code / Cursor:**
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
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` (default, for AI clients) or `http` (for self-hosted deployments) |
| `MCP_PORT` | `3000` | HTTP server port (only used when `MCP_TRANSPORT=http`) |
| `MCP_PATH` | `/` | HTTP endpoint path (only used when `MCP_TRANSPORT=http`) |
| `MCP_MAX_BODY_BYTES` | `10485760` | Maximum request body size in bytes (10 MB default) |

**On-premise example (no API key needed):**
```bash
CARBONE_BASE_URL=https://your-carbone-server.com \
node dist/index.js
```

**Self-hosted HTTP mode example:**
```bash
CARBONE_API_KEY=your_key \
CARBONE_BASE_URL=https://your-carbone-server.com \
MCP_TRANSPORT=http \
MCP_PORT=3000 \
node dist/index.js
```

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
  "mcp":    { "version": "1.0.0" },
  "carbone": { "version": "4.x.x" }
}
```

The `carbone` field shows backend connectivity:
- `{ "version": "..." }` — reachable and authenticated
- `{ "error": "unauthorized", "message": "..." }` — reachable but no/invalid API key
- `{ "error": "unreachable", "message": "..." }` — network error, timeout, or unexpected response

---

## Security

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
- See [Privacy Policy](https://carbone.io/privacy) for details

---

## Development

```bash
npm run dev          # Run with tsx (no build needed)
npm run build        # Compile TypeScript → dist/
npm test             # Run unit tests
npm run test:watch   # Watch mode
npm run test:integration  # Real API tests (requires CARBONE_TEST_API_KEY)
npm run test:coverage     # Coverage report
```

---

## Docker Deployment

### Build image

```bash
docker build -t carbone-mcp:latest .
```

### Run as stdio (for AI clients)

```bash
docker run -i --rm \
  -e CARBONE_API_KEY=your_key_here \
  carbone-mcp:latest
```

### Claude Desktop config (Docker stdio)

```json
{
  "mcpServers": {
    "carbone": {
      "command": "docker",
      "args": ["run", "-i", "--rm",
               "-e", "CARBONE_API_KEY=your_key_here",
               "carbone-mcp:latest"]
    }
  }
}
```

### Run as HTTP server

```bash
docker run -d \
  -p 3000:3000 \
  -e CARBONE_API_KEY=your_key_here \
  -e MCP_TRANSPORT=http \
  -e MCP_PORT=3000 \
  carbone-mcp:latest
```

### Docker Compose (HTTP mode)

```yaml
services:
  carbone-mcp:
    image: carbone-mcp:latest
    ports:
      - 3000:3000
    environment:
      - CARBONE_API_KEY=${CARBONE_API_KEY:-}
      - CARBONE_BASE_URL=${CARBONE_BASE_URL:-https://api.carbone.io}
      - CARBONE_TIMEOUT=${CARBONE_TIMEOUT:-60000}
      - MCP_TRANSPORT=http
      - MCP_PORT=3000
      - MCP_PATH=/
    restart: unless-stopped
```

Start it:
```bash
CARBONE_API_KEY=your_key docker compose up -d
```

Then connect your AI client to `http://your-server:3000`.

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
- [Template syntax](https://carbone.io/documentation/developer/introduction.html)
- [HTML templates guide](https://carbone.io/documentation/design/template-formats/html.html)
- [Markdown templates guide](https://carbone.io/documentation/design/template-formats/markdown.html)

---

## Supported Output Formats

| Category | Formats |
|---|---|
| Documents | PDF, DOCX, XLSX, PPTX, ODT, ODS, ODP, RTF, EPUB |
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

## Support

- 📚 **Documentation:** [carbone.io/documentation](https://carbone.io/documentation)
- 🐛 **Bug Reports:** [GitHub Issues](https://github.com/carboneio/carbone-mcp/issues)
- 💬 **Live Chat:** [carbone.io](https://carbone.io) (bottom-right widget)
- 📧 **Enterprise:** contact@carbone.io

---

## Links

- [Carbone API documentation](https://carbone.io/documentation/developer/http-api/introduction.html)
- [OpenAPI specification](https://carbone.io/file/carbone.OpenAPI.yml)
- [MCP specification](https://modelcontextprotocol.io)
- [Full API Reference](./docs/API.md)

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
