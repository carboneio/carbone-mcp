# Carbone MCP Server

Run the official Carbone MCP server yourself: a Streamable HTTP endpoint that lets AI assistants automate production-ready PDF, Word, Excel and PowerPoint documents from templates and JSON through the Carbone API.

> **Upgrading from 1.x?** Every 1.x HTTP deployment should upgrade now (security fixes): read the [upgrade notes](https://github.com/carboneio/carbone-mcp/blob/master/CHANGELOG.md#upgrading-from-1x).

## Quick start

```bash
docker run -d --name carbone-mcp -p 127.0.0.1:3000:3000 carbone/carbone-mcp
curl http://localhost:3000/health
```

```json
{
  "mcp": { "version": "2.0.0" },
  "carbone": { "version": "5.x.x" }
}
```

This quick start sets **no server key**: each MCP client sends its own Carbone key in `Authorization: Bearer <key>`, and only your machine can reach the port. Get a key at [account.carbone.io](https://account.carbone.io). The **test key** generates unlimited watermarked PDFs for free; the **production key** produces every format without a watermark ([details](https://carbone.io/documentation/developer/http-api/introduction.html#requirements)).

**Serving other machines:** publish the port behind a TLS reverse proxy, keep the server without `CARBONE_API_KEY` (or set `CARBONE_REQUIRE_CLIENT_AUTH_HEADER=true`), and list the hostnames of browser-based clients in `MCP_ALLOWED_ORIGINS`.

### Shared-key variant, for one user on one machine

```bash
docker run -d --name carbone-mcp -p 127.0.0.1:3000:3000 -e CARBONE_API_KEY=your_api_key_here carbone/carbone-mcp
```

> **Warning:** every request without a Bearer key then spends **your** key: anyone who can reach the port uses your Carbone account. The server prints a warning at startup. Never publish this port on a network you don't fully trust, or set `CARBONE_REQUIRE_CLIENT_AUTH_HEADER=true` to refuse requests that bring no key of their own.

## What it does

- Converts DOCX, XLSX, PPTX, HTML, Markdown and PDF files to PDF, images, CSV and other formats (100+ formats)
- Fills Word, Excel, PowerPoint, LibreOffice, HTML and Markdown templates with JSON data, and tells you which data a template expects
- Adds passwords, watermarks and PDF/A to PDFs, with a choice of converter: LibreOffice, OnlyOffice, Chromium or Carbone ICE
- Generates up to 100 documents per request, delivered to your webhook, with translations, time zones and currency conversion
- Manages a template library: upload, version, categorize, deploy and download templates

## Docker Compose

```yaml
services:
  carbone-mcp:
    image: carbone/carbone-mcp
    ports:
      - 127.0.0.1:3000:3000   # local only; serve other machines through a TLS reverse proxy
    restart: unless-stopped
```

```bash
docker compose up -d
```

Add any variable below under `environment:`. Leave `CARBONE_API_KEY` out so that clients send their own key: setting it gives you the shared-key variant above.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CARBONE_API_KEY` | none | Your Carbone API key ([get one](https://account.carbone.io)). Optional in HTTP mode: leave it unset so each client sends its own `Authorization: Bearer <key>`. When set, requests without a Bearer key spend it (see `CARBONE_REQUIRE_CLIENT_AUTH_HEADER`). Required in stdio mode for the cloud API. Not required for on-premise deployments. |
| `CARBONE_BASE_URL` | `https://api.carbone.io` | Carbone API URL. Set it to your on-premise instance (no key needed). |
| `CARBONE_TIMEOUT` | `60000` | Carbone API request timeout in milliseconds. Carbone Cloud's synchronous API has its own 60-second limit. |
| `CARBONE_MAX_FILE_BYTES` | `104857600` | Maximum size (bytes) of one input file, given as a URL or base64 (100 MB). |
| `MCP_TRANSPORT` | `http` | Transport mode: `http` (image default) or `stdio`. |
| `MCP_PORT` | `3000` | HTTP server port. |
| `MCP_PATH` | `/` | HTTP endpoint path. Cannot be `/health`. |
| `MCP_MAX_BODY_BYTES` | `62914560` | Maximum size of one incoming MCP message (60 MB): an HTTP request body (HTTP 413 when exceeded) or one stdio message. |
| `MCP_ALLOWED_ORIGINS` | none | Browser `Origin` hostnames allowed in addition to `localhost`, `127.0.0.1` and `[::1]`: comma-separated, without scheme or port (e.g. `app.example.com`); `<scheme>://*` allows a browser-extension scheme. A request with any other `Origin` gets HTTP 403; requests without one are unaffected. Invalid entries stop the container at startup. |
| `CARBONE_REQUIRE_CLIENT_AUTH_HEADER` | `false` | Require `Authorization: Bearer <key>` on every request. Left `false`, a request with no Bearer key falls back to the server-level `CARBONE_API_KEY` (a shared-key server: anyone reaching the port can spend it). Set `true` to require per-client keys. No effect when no server key is set. |
| `CARBONE_ALLOW_PRIVATE_NETWORK` | `false` | Allow user-supplied URLs to resolve to private and internal addresses. Off by default to block SSRF. |

## Connect your MCP client (HTTP)

Point the client at `http://localhost:3000` (Streamable HTTP) with the header `Authorization: Bearer <your Carbone API key>`.

**Claude Code:**

```bash
claude mcp add --transport http carbone http://localhost:3000 --header "Authorization: Bearer your_api_key_here"
```

**VS Code** (`.vscode/mcp.json`; VS Code asks for the key once and stores it):

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

Over HTTP, file inputs must be URLs or base64: the server cannot read the client's local files. A generated PDF or Office file comes back as a download attachment; ask for `returnLink` to get Carbone's one-time download URL instead ([output and file delivery](https://github.com/carboneio/carbone-mcp/blob/master/docs/API.md#output--file-delivery)).

## Claude Desktop (stdio)

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

From Claude Desktop, the stdio mode above works on every plan. A claude.ai or Claude Desktop custom connector connects from Anthropic's cloud: it can also reach this server once it is published at a public HTTPS URL (not `127.0.0.1`), where your organization has Anthropic's **Request headers** beta, which sends the Bearer key ([Anthropic docs](https://claude.com/docs/connectors/building/authentication)). To connect without a key, use Carbone's hosted server `https://mcp.carbone.io`, which signs you in with your Carbone account.

## On-premise Carbone

Point the server at your own Carbone instance; no API key is needed:

```bash
docker run -d -p 127.0.0.1:3000:3000 -e CARBONE_BASE_URL=https://your-carbone-server.com carbone/carbone-mcp
```

## Tools

The server exposes 12 tools to convert and render documents, inspect templates and manage a template library: see the [API reference](https://github.com/carboneio/carbone-mcp/blob/master/docs/API.md).

## Security and troubleshooting

- **URL inputs:** URLs that resolve to a private or internal address (`localhost`, RFC 1918, cloud metadata) are refused by default. Set `CARBONE_ALLOW_PRIVATE_NETWORK=true` only on a trusted deployment with internal template hosts. Local paths are always refused over HTTP.
- **Shared key:** a server-level `CARBONE_API_KEY` is spent by every request that brings no key of its own, unless `CARBONE_REQUIRE_CLIENT_AUTH_HEADER=true` (see the shared-key variant above).
- **HTTP 403 `Invalid Origin`:** a browser-based client served from a host other than `localhost`. Add its hostname to `MCP_ALLOWED_ORIGINS`.
- **HTTP 405 when you open the endpoint in a browser:** expected, the endpoint only answers MCP `POST` requests. Check the server with `GET /health`.
- **Prompt injection:** a document or template can carry instructions aimed at the AI. Review tool calls before you confirm them.

More in the [Security section of the README](https://github.com/carboneio/carbone-mcp#security).

## Tags

| Tag | Description |
|---|---|
| `latest` | Latest stable release |
| `2.0.0` | Specific version |
| `2.0` | Latest patch of 2.0 |
| `2` | Latest minor of v2 |

Supported platforms: `linux/amd64`, `linux/arm64`

## Links

- [GitHub repository](https://github.com/carboneio/carbone-mcp)
- [Carbone documentation](https://carbone.io/documentation)
- [Carbone API reference](https://carbone.io/documentation/developer/http-api/introduction.html)
- [Get an API key](https://account.carbone.io)
