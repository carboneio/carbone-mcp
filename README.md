# Carbone MCP Server

[![npm version](https://img.shields.io/npm/v/carbone-mcp.svg)](https://www.npmjs.com/package/carbone-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.carbone%2Fcarbone--mcp-blue?logo=modelcontextprotocol)](https://registry.modelcontextprotocol.io/?q=io.carbone%2Fcarbone-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Generate PDF, Word, Excel and PowerPoint documents from templates and JSON data, and convert files between 36 formats, from Claude, Cursor, VS Code or any MCP client. The official server for the [Carbone](https://carbone.io) document generation API.

- **Convert files:** DOCX, XLSX, PPTX, HTML, Markdown or PDF to PDF, images, CSV, ODT and [the other output formats](docs/API.md#supported-output-formats).
- **Fill templates with JSON:** design them in Word, Excel, PowerPoint, LibreOffice, HTML or Markdown with `{d.field}` tags, or fill an existing PDF form.
- **Finish your PDFs:** passwords, watermarks, PDF/A, page ranges, and a choice of converter (LibreOffice, OnlyOffice, Chromium or Carbone ICE).
- **Batch and localize:** up to 100 documents per request, delivered to your webhook; translations, time zones, and currency conversion at the rates you give.
- **Keep a template library:** upload, version, categorize, deploy and download templates, and ask which data a template expects.

## What you can ask

These work with the free test key, which outputs watermarked PDFs:

- *"Convert this Markdown to PDF: # Quarterly update …"*
- *"Fill my invoice template with this JSON and give me a PDF: {"customer": "Acme", "total": 1500}"*
- *"Which data does this contract template need?"* (`inspect_template` lists its tags and drafts a sample JSON)

More in [Example prompts](#example-prompts), including with Salesforce, HubSpot, Notion and Stripe.

## Quick start

> Upgrading from 1.x? Read the [upgrade notes](CHANGELOG.md#upgrading-from-1x) — HTTP deployments should upgrade now (security fixes).

### Prerequisites

- **A Carbone API key** from [account.carbone.io](https://account.carbone.io). Your account has two keys ([details](https://carbone.io/documentation/developer/http-api/introduction.html#requirements)):
  - **Test key**: unlimited watermarked PDFs, free (PDF output only). Templates stored with it are kept for up to 30 days.
  - **Production key**: any output format, no watermark. The free Sandbox plan includes 100 credits per month.
- **Node.js 20.3 or later** for the local package (`npx carbone-mcp`). Check with `node --version`. The Docker image needs Docker only.

### Choose a setup

| Setup | Runs | Clients | Local files |
|---|---|---|---|
| [Local package (stdio)](#local-package-stdio) | `npx carbone-mcp` on your machine | Claude Desktop, Claude Code, VS Code, Cursor, and any client that starts local servers | ✅ reads local paths, saves documents to disk |
| [Hosted server (HTTP)](#hosted-server-mcpcarboneio) | `https://mcp.carbone.io`, nothing to install | Clients that can send an `Authorization` header: Claude Code, VS Code, Cursor, … | ❌ URLs and base64 only |
| [Docker (HTTP)](#docker) | Your own server | Same as the hosted server | ❌ URLs and base64 only |

**Claude Desktop:** use the local package. **claude.ai** on the web reaches remote servers only, as connectors: see [claude.ai and Claude Desktop connectors](#claudeai-and-claude-desktop-connectors).

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

**VS Code:** `.vscode/mcp.json` uses `servers`, not `mcpServers`. With an input variable, VS Code asks for the key once and stores it securely:

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

### Hosted server (mcp.carbone.io)

Nothing to install: connect to `https://mcp.carbone.io` over Streamable HTTP and send your key in the header `Authorization: Bearer <your API key>`. Over HTTP, file inputs must be URLs or base64 ([File inputs](#file-inputs)).

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

**Cursor** (`~/.cursor/mcp.json` or `.cursor/mcp.json`; `"Bearer ${env:CARBONE_API_KEY}"` reads the key from your environment):

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

### claude.ai and Claude Desktop connectors

mcp.carbone.io authenticates with your Carbone API key, which a custom connector sends through **Request headers** (an Anthropic beta: check that your organization has it; [setup](https://claude.com/docs/connectors/custom/add-unlisted#authenticate-with-request-headers)):

1. Add a custom connector with the URL `https://mcp.carbone.io` and the authentication **No sign-in**.
2. Under **Request headers**, choose `authorization` and enter `Bearer <your Carbone API key>`, including `Bearer ` and the space.

An Owner enters the key once and every member of the organization uses it, so every document counts against that one Carbone account: use a dedicated key. Without Request headers, custom connectors on claude.ai and Claude Desktop [authenticate](https://claude.com/docs/connectors/building/authentication) with OAuth or not at all; in Claude Desktop, use the [local package](#local-package-stdio).

## Files in and out

### File inputs

`file` (`convert_document`) and `template` (`render_document`, `inspect_template`, `upload_template`) accept:

| Form | Example | stdio | HTTP |
|---|---|---|---|
| Absolute local path | `/Users/me/invoice.docx`, `~/invoice.docx`, `C:\Users\me\invoice.docx` | ✅ | ❌ refused |
| URL | `https://example.com/invoice.docx` | ✅ | ✅ |
| Base64 | the file content, base64-encoded | ✅ | ✅ |

Any other string, such as a bare `invoice.docx`, is read as base64 and fails. Relative paths (`./…`, `../…`) resolve against the server's working directory, which your client chooses: prefer absolute paths. The JSON parameters (`data`, `complement`, …) also accept a path, URL or base64 string pointing to a JSON file ([details](docs/API.md#pass-json-by-reference)).

### Output delivery

| Output | stdio (local clients) | HTTP (remote / self-hosted) |
|---|---|---|
| Text: HTML, TXT, CSV, MD, XML, JSON (template samples) | inline text | inline text |
| Images: PNG, JPG, GIF, WEBP | inline image | inline image |
| Everything else: PDF, Office, SVG, TIFF… | saved to a temp file, path returned | returned as a download attachment |

You can instead save to a path you choose (`outputPath`, stdio only), get an attachment for any format (`asAttachment`), or get a one-time download link (`returnLink`): see [Output and file delivery](docs/API.md#output--file-delivery).

> **Claude Desktop** cannot display inline binary attachments (it mishandles them as images). For PDF and Office files, keep the default temp-file path, or ask for **`returnLink`** to get a download URL.

## Tools

| Tool | What it does |
|---|---|
| `convert_document` | Converts a file to another format; Carbone tags stay as written |
| `render_document` | Fills a template with JSON data, and can convert the result (to PDF, for example) |
| `inspect_template` | Lists a template's tags and returns a matching sample dataset. Runs one render on your account (counts as one document generation) |
| `list_templates` | Lists stored templates, filtered by category, name or ID |
| `list_categories` | Lists the template categories in your account |
| `list_tags` | Lists the tags used across your templates |
| `upload_template` | Stores a reusable template, with versions, category and tags |
| `update_template_metadata` | Renames, categorizes, tags, deploys or schedules the deletion of a template version |
| `delete_template` | Deletes a template or one of its versions, immediately |
| `download_template` | Downloads a template's original file, or the sample data stored with it |
| `get_api_status` | Checks the Carbone API's health and version |
| `get_capabilities` | Summarizes the formats, features and usage examples |

Every parameter, with examples: [docs/API.md](docs/API.md).

## Example prompts

**With your other tools.** Carbone turns data that another MCP server fetches into a finished document. These assume that server (Salesforce, HubSpot, Notion, Stripe, …) is connected in the same client.
- *"Get the Acme Corp opportunity and its products from Salesforce, fill my 'Sales quote' template and give me the PDF"*
- *"For each HubSpot deal that moved to Closed Won this week, fill the 'Service agreement' template and save the PDFs in ~/Contracts"*
- *"Inspect my 'Invoice' template, map its fields to the HubSpot deal 'Acme renewal', and show me the JSON before you render it"*
- *"Collect the tasks marked Done in the Notion 'Sprint 42' database and fill our 'Sprint report' template as a DOCX"*
- *"List last month's paid Stripe invoices for Acme Corp and produce an account statement with the 'Statement' template"*
- *"Read the attendee list from the 'Workshop' Google Sheet and create one certificate per attendee from the 'Certificate' template"*
- *"Summarize the pull requests merged on GitHub this week into our 'Release notes' template, then post a two-line summary in #releases on Slack"*

**Templates and data**
- *"Generate an invoice from template 1530905183164918624 with {customer: 'Acme Corp', total: 1500, items: [...]}"*
- *"Fill ~/templates/offer-letter.docx with ~/hr/jane-doe.json and save the PDF as ~/Documents/offer-jane-doe.pdf"*
- *"Show me template 1530905183164918624 as a PDF with its tags still visible, so I can check the layout"*

**Convert**
- *"Convert /Users/me/contracts/contract.docx to PDF with the Carbone ICE converter"*
- *"Turn https://example.com/sales.xlsx into a CSV separated by semicolons"*
- *"Render this PDF as a PNG thumbnail"*

**Batch and localization**
- *"Create one invoice per customer in ~/data/invoices.json, as a ZIP of files named invoice-{d.id}, delivered to my webhook https://example.com/hook"*
- *"Generate this invoice in French, German and Spanish from the same template"*
- *"Render the report with prices converted from EUR to USD at 1.08, and dates in New York time"*

**PDF options and template library**
- *"Convert this DOCX to a PDF with the open password 'secret123' and a DRAFT watermark at 20% opacity"*
- *"Make a PDF/A-2b copy of pages 1 to 5 of this NDA for archiving"*
- *"Deploy the newest version of my invoice template, and schedule the old one for deletion in 30 days"*

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
| Password, watermark or PDF/A missing from a PDF | PDF/A, page ranges and accessibility use the default converter `L` (LibreOffice); `O`, `C` and `I` apply passwords, permissions and watermarks. For PDF → PDF the server sets `hardRefresh` for you: don't pass `hardRefresh: false`. |
| Claude Desktop shows no Carbone tools, or the server disconnects | Read `mcp-server-carbone.log` (the server's stderr) in `~/Library/Logs/Claude/` (macOS) or `%APPDATA%\Claude\logs\` (Windows). A good start logs `Carbone MCP Server v2.0.0 started (stdio)`. |
| You want to test the server without an AI client | Run the [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) (Node.js 22.19+): `npx @modelcontextprotocol/inspector -e CARBONE_API_KEY=your_api_key_here npx carbone-mcp`. It lists the tools and shows each request and response. |

## Self-hosting

### Docker

The image serves Streamable HTTP on port 3000. This quick start sets **no server key**: each client sends its own key in `Authorization: Bearer <key>`, exactly as with mcp.carbone.io, and the port is reachable from your machine only.

```bash
docker run -d --name carbone-mcp -p 127.0.0.1:3000:3000 carbone/carbone-mcp
curl http://localhost:3000/health
```

Connect your client with the [hosted server config](#hosted-server-mcpcarboneio), replacing `https://mcp.carbone.io` with `http://localhost:3000`. To serve other machines, publish the port behind a TLS reverse proxy, keep the server without `CARBONE_API_KEY` (or set `CARBONE_REQUIRE_CLIENT_AUTH_HEADER=true`), and list the hostnames of browser-based clients in `MCP_ALLOWED_ORIGINS`.

**Shared-key variant, for one user on one machine.** A server-level key lets clients connect without sending one:

```bash
docker run -d --name carbone-mcp -p 127.0.0.1:3000:3000 -e CARBONE_API_KEY=your_api_key_here carbone/carbone-mcp
```

Read [the shared-key warning](#security) before you use it.

**Docker Compose:** [compose.yml](compose.yml) builds the image from this repository, binds `127.0.0.1` only, sets no server key, and passes through every variable of [.env.example](.env.example). Start it with `docker compose up -d`. Compose also reads `CARBONE_API_KEY` from your shell or a `.env` file: if it is set there, you get the shared-key variant.

To run the image as a stdio server for Claude Desktop, see the [Docker Hub page](docs/DOCKER_HUB.md#claude-desktop-stdio).

### On-premise Carbone

If you run [Carbone on-premise](https://carbone.io/pricing.html), point the server at your instance with `CARBONE_BASE_URL`; no API key is needed. For example `CARBONE_BASE_URL=https://your-carbone-server.com npx carbone-mcp`, or add `-e CARBONE_BASE_URL=https://your-carbone-server.com` to `docker run`.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `CARBONE_API_KEY` | none | Your Carbone API key: required in stdio for Carbone Cloud, optional over HTTP ([Security](#security)) |
| `CARBONE_BASE_URL` | `https://api.carbone.io` | Carbone API URL; set it to an on-premise instance (no key needed) |
| `CARBONE_TIMEOUT` | `60000` | Carbone API request timeout in ms; Carbone Cloud's own limit is 60 s |
| `CARBONE_MAX_FILE_BYTES` | `104857600` (100 MB) | Largest input file read from a path, URL or base64 |
| `MCP_TRANSPORT` | `stdio` (`http` in Docker) | `stdio` or `http` |
| `MCP_PORT` | `3000` | HTTP port |
| `MCP_PATH` | `/` | HTTP endpoint path; cannot be `/health` |
| `MCP_MAX_BODY_BYTES` | `62914560` (60 MB) | Largest MCP message: an HTTP body (`413` above it) or a stdio message |
| `MCP_ALLOWED_ORIGINS` | none (localhost is always allowed) | HTTP: browser `Origin` hostnames to allow, comma-separated |
| `CARBONE_REQUIRE_CLIENT_AUTH_HEADER` | `false` | HTTP: `true` refuses requests that bring no Bearer key of their own |
| `CARBONE_ALLOW_PRIVATE_NETWORK` | `false` | `true` lets URL inputs reach private and internal addresses |

Full descriptions: [Configuration in docs/API.md](docs/API.md#configuration).

## Security

- **URL inputs and local files.** URLs that resolve to a private or internal address (`localhost`, RFC 1918, cloud metadata) are refused unless `CARBONE_ALLOW_PRIVATE_NETWORK=true` ([details](docs/API.md#url-guard)). Local paths are read in stdio only, where the server runs as you; over HTTP they are refused.
- **Shared server key (HTTP).** With `CARBONE_API_KEY` set on an HTTP server and `CARBONE_REQUIRE_CLIENT_AUTH_HEADER=false` (the default), every request without a Bearer key spends **that key**: anyone who can reach the port uses that Carbone account. The server prints a warning at startup. Never publish such a port on a network you don't fully trust, or set `CARBONE_REQUIRE_CLIENT_AUTH_HEADER=true` so each client must bring its own key. This doesn't apply when no server key is set (for example on-premise Carbone without authentication).
- **Browser origins (HTTP).** A request whose `Origin` header is present but not allowed gets `403`, so a malicious web page cannot reach a locally running server (DNS rebinding) and spend its key. `localhost`, `127.0.0.1` and `[::1]` are allowed; list the browser-based clients you trust in `MCP_ALLOWED_ORIGINS`. Requests without an `Origin` (desktop, CLI and server-side clients) are unaffected.
- **Prompt injection.** A document or template can contain instructions that trick the AI into unintended actions, such as sending data elsewhere or deleting templates. Review what your client is about to do before you confirm a tool call.
- **API keys.** Keep them out of version control, pass them through your client's secret input or environment, and rotate them at [account.carbone.io](https://account.carbone.io).
- **Your data.** Carbone stores the templates and samples you upload, and keeps documents rendered with `returnLink` or a webhook until they are downloaded. See the [privacy policy](https://carbone.io/company/privacy-policy.html), or run [Carbone on-premise](#on-premise-carbone) for full control.

## Writing templates

Design a template in Word, Excel, PowerPoint, LibreOffice, HTML or Markdown, and put tags where the data goes:

```
Dear {d.customer.name},
Your invoice total is {d.total:formatC()}.
Items:
{d.items[i].description}  {d.items[i].quantity}x  {d.items[i].price:formatC()}
{d.items[i+1]}
```

`{d.items[i]}` … `{d.items[i+1]}` repeats a line for each item. Start with [the basics](https://carbone.io/documentation/design/substitutions/the-basics.html), or give your AI assistant the [Carbone Skill](https://carbone.io/documentation/developer/ai/skills.html), a template syntax reference for AI tools ([download .skill](https://github.com/carboneio/carbone-skill/releases/latest/download/carbone.skill) · [GitHub](https://github.com/carboneio/carbone-skill)).

## Contributing

Bug reports, fixes and documentation improvements are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the development setup, tests, debugging and the pull request process.

## Support

- **Documentation:** [MCP server](https://carbone.io/documentation/developer/ai/mcp.html) · [HTTP API](https://carbone.io/documentation/developer/http-api/introduction.html) · [Template design](https://carbone.io/documentation/design/overview/getting-started.html) · [OpenAPI specification](https://carbone.io/file/carbone.OpenAPI.yml)
- **Bugs and feature requests:** [GitHub Issues](https://github.com/carboneio/carbone-mcp/issues)
- **Questions:** live chat on [carbone.io](https://carbone.io) (bottom-right widget) · **Enterprise:** contact@carbone.io

## License

Apache 2.0, see [LICENSE](LICENSE).
