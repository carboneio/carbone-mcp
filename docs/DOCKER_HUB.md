# Carbone MCP Server

**Official Carbone MCP server** — Turn AI assistants into document automation experts. Generate professional PDFs, invoices, reports, and convert documents using natural language.

Give Claude, ChatGPT, and other AI assistants the power to:
- Convert between 100+ document formats instantly (Office, HTML, Markdown → PDF, PNG, CSV…)
- Generate PDF, DOCX, XLSX, PPTX from templates and JSON data using `{d.field}` tags
- Manage template libraries with versioning, categorization, and metadata
- Fill PDF forms programmatically
- Create batch documents — invoices, certificates, contracts, payslips — in one request
- Add watermarks, passwords, encryption, and PDF/A compliance
- Handle localization: multi-language, currency conversion, timezone formatting

Get your free API key at [account.carbone.io](https://account.carbone.io).

---

## Quick Start — HTTP Server (recommended for Docker)

```bash
docker run -d \
  -p 3000:3000 \
  -e CARBONE_API_KEY=your_api_key_here \
  carbone/carbone-mcp
```

Connect your MCP client to `http://your-host:3000` with `Authorization: Bearer your_api_key_here`.

### Health check

```bash
curl http://localhost:3000/health
```

```json
{
  "mcp": { "version": "1.1.3" },
  "carbone": { "version": "5.x.x" }
}
```

---

## Docker Compose

```yaml
services:
  carbone-mcp:
    image: carbone/carbone-mcp
    ports:
      - 3000:3000
    environment:
      - CARBONE_API_KEY=${CARBONE_API_KEY}
      - MCP_PORT=3000
    restart: unless-stopped
```

```bash
CARBONE_API_KEY=your_key docker compose up -d
```

---

## Connect to VS Code / Cursor / Claude Code (HTTP)

```json
{
  "mcp": {
    "servers": {
      "carbone": {
        "type": "streamable-http",
        "url": "http://your-host:3000",
        "headers": {
          "Authorization": "Bearer your_api_key_here"
        }
      }
    }
  }
}
```

---

## Connect to Claude Desktop (stdio)

Claude Desktop does not support HTTP Bearer token authentication. Use stdio transport instead:

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

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CARBONE_API_KEY` | — | Your Carbone API key ([get one free →](https://account.carbone.io)). Required for cloud API. Not required for on-premise deployments. |
| `CARBONE_BASE_URL` | `https://api.carbone.io` | Override for self-hosted Carbone instances. |
| `CARBONE_TIMEOUT` | `60000` | Request timeout in milliseconds. |
| `MCP_TRANSPORT` | `http` | Transport mode: `http` (default) or `stdio`. |
| `MCP_PORT` | `3000` | HTTP server port. |
| `MCP_PATH` | `/` | HTTP endpoint path. |
| `MCP_MAX_BODY_BYTES` | `62914560` | Maximum request body size (60 MB). Returns HTTP 413 when exceeded. |

---

## On-Premise Deployment

Point to your own Carbone server — no API key required:

```bash
docker run -d \
  -p 3000:3000 \
  -e CARBONE_BASE_URL=https://your-carbone-server.com \
  carbone/carbone-mcp
```

---

## Available Tools

| Tool | Description | Documentation |
|---|---|---|
| `convert_document` | Convert documents between 100+ formats | [Convert documents](https://carbone.io/documentation/developer/http-api/convert-reports.html) |
| `render_document` | Generate documents from templates + JSON data | [Generate documents](https://carbone.io/documentation/developer/http-api/generate-reports.html) |
| `list_templates` | Browse your template library | [List templates](https://carbone.io/documentation/developer/http-api/manage-templates.html#list-templates) |
| `upload_template` | Store reusable templates | [Upload a template](https://carbone.io/documentation/developer/http-api/manage-templates.html#upload-a-template) |
| `update_template_metadata` | Rename, tag, categorize templates | [Patch a template](https://carbone.io/documentation/developer/http-api/manage-templates.html#patch-a-template) |
| `delete_template` | Remove templates | [Delete a template](https://carbone.io/documentation/developer/http-api/manage-templates.html#delete-a-template) |
| `download_template` | Download original template files | [Download a template](https://carbone.io/documentation/developer/http-api/manage-templates.html#download-a-template) |
| `get_api_status` | Check API health and version |  |
| `get_capabilities` | View supported formats and features | |

---

## Tags

| Tag | Description |
|---|---|
| `latest` | Latest stable release |
| `1.1.3` | Specific version |
| `1.1` | Latest patch of 1.1 |
| `1` | Latest minor of v1 |

Supported platforms: `linux/amd64`, `linux/arm64`

---

## Links

- [GitHub Repository](https://github.com/carboneio/carbone-mcp)
- [Full Documentation](https://carbone.io/documentation)
- [Carbone API Reference](https://carbone.io/documentation/developer/http-api/introduction.html)
- [Get API Key](https://account.carbone.io)
