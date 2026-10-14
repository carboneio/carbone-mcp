# Carbone MCP Server

**Official Carbone MCP server** — Turn AI assistants into document automation experts. Generate professional PDFs, invoices, reports, and convert documents using natural language.

Give Claude, ChatGPT, and other AI assistants the power to:
- Convert between 100+ document formats instantly (Office, HTML, Markdown → PDF, PNG, CSV…)
- Generate PDF, DOCX, XLSX, PPTX from templates and JSON data using `{d.field}` tags
- Inspect a template: list the tags it uses and get a sample JSON dataset to fill it
- Manage template libraries with versioning, categorization, and metadata
- Fill PDF forms programmatically
- Create batch documents — invoices, certificates, contracts, payslips — in one request
- Add watermarks, passwords, encryption, and PDF/A compliance
- Pick the PDF engine per request: LibreOffice, OnlyOffice, Chromium, or Carbone ICE (`converter: "I"` — the fastest DOCX and ODT (beta) → PDF engine; like OnlyOffice and Chromium it supports the PDF password, permission and watermark options, while LibreOffice supports them all)
- Convert documents while keeping Carbone tags intact — proof a template in another format without resolving it
- Handle localization: multi-language, currency conversion, timezone formatting

Get your API key at [account.carbone.io](https://account.carbone.io). The **test key** is free and unlimited but produces watermarked PDFs only; the **production key** produces every format without watermark ([details](https://carbone.io/documentation/developer/http-api/introduction.html#requirements)).

---

## Quick Start — HTTP Server

The image runs in HTTP mode by default (`MCP_TRANSPORT=http`, port 3000). This quick start sets **no server key** — each MCP client sends its own Carbone key in `Authorization: Bearer <key>` — and publishes the port on your machine only:

```bash
docker run -d --name carbone-mcp -p 127.0.0.1:3000:3000 carbone/carbone-mcp
```

```bash
curl http://localhost:3000/health
```

```json
{
  "mcp": { "version": "1.x.x" },
  "carbone": { "version": "5.x.x" }
}
```

**Serving other machines:** publish the port behind a TLS reverse proxy, keep the server without `CARBONE_API_KEY` (or set `CARBONE_REQUIRE_CLIENT_AUTH_HEADER=true`), and list the hostnames of browser-based clients in `MCP_ALLOWED_ORIGINS` (others get HTTP 403; desktop, CLI and server-side clients send no `Origin` header and are unaffected).

### Shared-key variant — one user, local only

```bash
docker run -d --name carbone-mcp -p 127.0.0.1:3000:3000 -e CARBONE_API_KEY=your_api_key_here carbone/carbone-mcp
```

> ⚠️ Every request without a Bearer key then spends **your** key: anyone who can reach the port uses your Carbone account. The server prints a warning at startup. Never publish this port on a network you don't fully trust, or set `CARBONE_REQUIRE_CLIENT_AUTH_HEADER=true` to refuse requests without their own key.

---

## Docker Compose

```yaml
services:
  carbone-mcp:
    image: carbone/carbone-mcp
    ports:
      - 127.0.0.1:3000:3000          # local only; use a TLS reverse proxy to serve other machines
    environment:
      - CARBONE_API_KEY=${CARBONE_API_KEY:-}   # leave empty: clients send their own Bearer key
      - CARBONE_BASE_URL=${CARBONE_BASE_URL:-https://api.carbone.io}
      - CARBONE_TIMEOUT=${CARBONE_TIMEOUT:-60000}
      - CARBONE_MAX_FILE_BYTES=${CARBONE_MAX_FILE_BYTES:-104857600}
      - CARBONE_REQUIRE_CLIENT_AUTH_HEADER=${CARBONE_REQUIRE_CLIENT_AUTH_HEADER:-false}
      - CARBONE_ALLOW_PRIVATE_NETWORK=${CARBONE_ALLOW_PRIVATE_NETWORK:-false}
      - MCP_PORT=3000
      - MCP_PATH=${MCP_PATH:-/}
      - MCP_MAX_BODY_BYTES=${MCP_MAX_BODY_BYTES:-62914560}
      - MCP_ALLOWED_ORIGINS=${MCP_ALLOWED_ORIGINS:-}
    restart: unless-stopped
```

```bash
docker compose up -d
```

`docker compose` reads `CARBONE_API_KEY` from your shell or a `.env` file: if it is set there, you get the shared-key variant above.

---

## Connect your MCP client (HTTP)

Point the client at `http://localhost:3000` (Streamable HTTP) with the header `Authorization: Bearer <your Carbone API key>`.

**Claude Code:**

```bash
claude mcp add --transport http carbone http://localhost:3000 --header "Authorization: Bearer your_api_key_here"
```

**VS Code** (`.vscode/mcp.json` — VS Code asks for the key once and stores it):

```json
{
  "inputs": [
    { "type": "promptString", "id": "carbone-api-key", "description": "Carbone API key", "password": true }
  ],
  "servers": {
    "carbone": {
      "type": "http",
      "url": "http://localhost:3000",
      "headers": { "Authorization": "Bearer ${input:carbone-api-key}" }
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "carbone": {
      "url": "http://localhost:3000",
      "headers": { "Authorization": "Bearer your_api_key_here" }
    }
  }
}
```

Over HTTP, file inputs must be URLs or base64: the server cannot read the client's local files.

---

## Connect to Claude Desktop (stdio)

Claude Desktop starts local (stdio) servers from its config file (**Settings → Developer → Edit Config**):

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

In this mode, local paths and saved documents refer to the **container's** filesystem, which `--rm` deletes: pass URLs or base64 and ask for `returnLink`, or mount a folder with `-v` and use paths inside it. The npm package (`npx -y carbone-mcp`, Node.js 20.3+) reads and writes your own files directly.

Remote servers are added to claude.ai and Claude Desktop as custom connectors, which authenticate with OAuth or not at all; a fixed API-key request header is a beta for a limited set of organizations ([Anthropic docs](https://claude.com/docs/connectors/building/authentication)). This server authenticates with a Bearer key only, so the stdio mode above is the reliable way to use it from Claude Desktop.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CARBONE_API_KEY` | — | Your Carbone API key ([get one →](https://account.carbone.io)). Optional in HTTP mode: leave it unset so each client sends its own `Authorization: Bearer <key>`. When set, requests without a Bearer key spend it (see `CARBONE_REQUIRE_CLIENT_AUTH_HEADER`). Required in stdio mode for the cloud API. Not required for on-premise deployments. |
| `CARBONE_BASE_URL` | `https://api.carbone.io` | Override for self-hosted Carbone instances. |
| `CARBONE_TIMEOUT` | `60000` | Request timeout in milliseconds. |
| `CARBONE_MAX_FILE_BYTES` | `104857600` | Maximum size (bytes) for a resolved input file — URL or base64 (100 MB). |
| `MCP_TRANSPORT` | `http` | Transport mode: `http` (image default) or `stdio`. |
| `MCP_PORT` | `3000` | HTTP server port. |
| `MCP_PATH` | `/` | HTTP endpoint path. Cannot be `/health`. |
| `MCP_MAX_BODY_BYTES` | `62914560` | Maximum size of one incoming MCP message (60 MB): an HTTP request body (HTTP 413 when exceeded) or one stdio message. |
| `MCP_ALLOWED_ORIGINS` | `localhost`, `127.0.0.1`, `[::1]` | Browser `Origin` hostnames allowed in addition to the localhost default — comma-separated, without scheme or port (e.g. `app.example.com`); `<scheme>://*` allows a browser-extension scheme. A request with any other `Origin` gets HTTP 403; requests without one are unaffected. Invalid entries stop the container at startup. |
| `CARBONE_REQUIRE_CLIENT_AUTH_HEADER` | `false` | Require `Authorization: Bearer <key>` on every request. Left `false`, a request with no Bearer key falls back to the server-level `CARBONE_API_KEY` (a shared-key server — anyone reaching the port can spend it). Set `true` to require per-client keys. No effect when no server key is set. |
| `CARBONE_ALLOW_PRIVATE_NETWORK` | `false` | Allow user-supplied URLs to resolve to private/internal addresses. Off by default to block SSRF. |

---

## On-Premise Deployment

Point to your own Carbone server — no API key required:

```bash
docker run -d \
  -p 127.0.0.1:3000:3000 \
  -e CARBONE_BASE_URL=https://your-carbone-server.com \
  carbone/carbone-mcp
```

---

## Output & file delivery

In HTTP mode (the Docker default), a generated PDF / Office file is returned as a **download attachment** (an MCP `EmbeddedResource`); text and PNG/JPG/GIF/WEBP come back inline. Two options on `convert_document` / `render_document` change this:

- `asAttachment` — force a download attachment for any format
- `returnLink` — return Carbone's public **one-time** download URL instead of the bytes (hand it to the user; it is consumed by the first download)

> `outputPath` (save to a local file) is **stdio-only** — in HTTP mode the file would land inside the container, so it is rejected. See the [full API reference](https://github.com/carboneio/carbone-mcp/blob/master/docs/API.md#output--file-delivery).

---

## Available Tools

| Tool | Description | Documentation |
|---|---|---|
| `convert_document` | Convert documents between 100+ formats | [Convert documents](https://carbone.io/documentation/developer/http-api/convert-reports.html) |
| `render_document` | Generate documents from templates + JSON data | [Generate documents](https://carbone.io/documentation/developer/http-api/generate-reports.html) |
| `inspect_template` | List the tags a template uses and return a sample JSON dataset (runs one render on your account) | |
| `list_templates` | Browse your template library | [List templates](https://carbone.io/documentation/developer/http-api/manage-templates.html#list-templates) |
| `list_categories` | List template categories | [List categories](https://carbone.io/documentation/developer/http-api/manage-templates.html#list-categories) |
| `list_tags` | List tags used across templates | [List tags](https://carbone.io/documentation/developer/http-api/manage-templates.html#list-tags) |
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
| `2.0.0` | Specific version |
| `2.0` | Latest patch of 2.0 |
| `2` | Latest minor of v2 |

Supported platforms: `linux/amd64`, `linux/arm64`

---

## Links

- [GitHub Repository](https://github.com/carboneio/carbone-mcp)
- [Full Documentation](https://carbone.io/documentation)
- [Carbone API Reference](https://carbone.io/documentation/developer/http-api/introduction.html)
- [Get API Key](https://account.carbone.io)
