# Changelog

All notable changes to this project will be documented in this file.

---

## [2.1.3] — 2026-10-20

### Added

- `MCP_OPENAI_APPS_CHALLENGE`: OpenAI's domain-verification token, served as plain text at `/.well-known/openai-apps-challenge`, to submit the server to the ChatGPT plugin directory.

### Changed

- Only `render_document`, `convert_document`, `inspect_template` and `upload_template` are now marked as reaching outside sources: they download files from a URL you give, and `render_document` can also download images listed in the data or send the result to a webhook. The other tools only work within your Carbone account.
- `get_capabilities` and the instructions the server sends at connection present the Carbone Skill and the documentation as references, instead of asking the assistant to load them.
- The PNG version of the Carbone icon that MCP clients receive at connection is smaller (128×128, 4 KB instead of 14 KB). The SVG version is unchanged.

### Security

- **HTTP mode no longer serves a `public/` folder from its working directory.** A server started from a folder that contains its own `public/` (a web project, for example) exposed every file in it, without notice. The Docker image and the npm package never included one.

---

## [2.1.2] — 2026-10-20

### Changed

- Every tool also carries its display name in its annotations, where Claude's connector directory reads it.
- Every tool states explicitly whether it only reads, whether it can delete or overwrite data, and whether it reaches outside services, as ChatGPT's plugin directory asks.
- `update_template_metadata` is marked as destructive: it can overwrite a template's details and schedule its deletion, so assistants ask before running it.
- `/health` answers at once with the last known Carbone API status, checked in the background, so a slow Carbone API no longer delays it. Right after start, the status shows as `checking`.

---

## [2.1.1] — 2026-10-15

Patch release: documentation and registry entry for sign-in on mcp.carbone.io. No code changes; every setup behaves as in 2.1.0.

### Changed

- **mcp.carbone.io now signs you in with your Carbone account.** claude.ai and Claude Desktop connectors, Claude Code, VS Code, Cursor and other MCP clients sign in from your browser; the README shows how. Existing setups keep working.
- Signed in, the hosted server uses your production key once your account has a plan (the Free plan included), and the test key, which outputs watermarked PDFs, until then.
- The MCP Registry entry for the hosted server now uses sign-in, with a new description.

---

## [2.1.0] — 2026-10-15

Minor release: sign-in with a Carbone account for Carbone's hosted server (opt-in, off unless configured), and a fix for `Authorization` headers that do not carry a Carbone key. Self-hosted, on-premise and stdio setups behave as in 2.0.0.

### Added

- **Sign-in with a Carbone account, for Carbone's hosted server.** Prepares mcp.carbone.io to let MCP clients sign in with their Carbone account instead of pasting an API key; API keys keep working. Self-hosted and on-premise servers are unaffected.
- CORS: `Access-Control-Expose-Headers: WWW-Authenticate, Mcp-Session-Id, Retry-After`, so browser-based clients can read the sign-in challenge and how long to wait after a `429` or `503`.

### Fixed

- An `Authorization` header with another scheme (such as `Basic` from a reverse proxy), `Bearer` without a key, or a tab instead of a space after `Bearer`, is no longer sent to the Carbone API as if it were an API key. The request is treated as having no key: the server key is used when one is configured.

---

## [2.0.0] — 2026-10-14

Major release: MCP protocol 2026-07-28 (MCP TypeScript SDK v2), Carbone API v5.15.0, and security fixes. Changes since 1.6.0; **BREAKING** marks what can break a 1.6.0 user.

**Security: upgrade now if you run the server in HTTP mode** (self-hosted or Docker, reachable by remote clients). Every 1.x HTTP deployment is affected by the URL-input issue under [Security](#security); there is no 1.x patch. stdio users (Claude Desktop, Claude Code, Cursor, … on your own machine) should upgrade too, for the `outputPath` fixes.

### Upgrading from 1.x

- Node.js **20.3** or later for `npx` / npm installs.
- HTTP mode: browser-based clients served from an origin other than `localhost` get `403` until their hostname is listed in `MCP_ALLOWED_ORIGINS`. Desktop, CLI and server-side clients are unaffected.
- HTTP mode: `GET` and `DELETE` on the MCP endpoint answer `405`; clients talk to it with `POST` only.
- `compose.yml` publishes the port on `127.0.0.1` only; edit the `ports` line to serve other machines.
- `convertTo` no longer accepts `zip` (use `batchOutput`) or `cdr`.
- `outputPath` must name a new file: an existing path is refused.
- `upload_template`: `sample` takes at most one object; `name`, `comment` and `category` are limited to 200 characters.
- Error message texts changed; library users get `CarboneGenerationError` and `CarboneConnectionError`.
- `update_template_metadata`: use `moveToTemplateId`; the 1.6.0 name `id` is still accepted.

### Changed

- **Migrated to MCP TypeScript SDK v2** (`@modelcontextprotocol/server` and `@modelcontextprotocol/client` 2.3.1, `@modelcontextprotocol/node` 2.1.1). The MCP specification published a new major revision, [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog), and the TypeScript SDK split the monolithic `@modelcontextprotocol/sdk` (v1) package into `@modelcontextprotocol/client`, `@modelcontextprotocol/server`, and `@modelcontextprotocol/node`. Migrated using the official codemod, plus manual fixes for context-parameter destructuring and a couple of output-only tool schemas that needed wrapping in `z.object(...)` to hit the non-deprecated `registerTool` overload.
- **Serves MCP protocol 2026-07-28 and 2025-era clients, on both transports.** Clients that negotiate 2026-07-28 (discovery via `server/discover`, a `_meta` envelope on every request, no session) are served alongside clients that open with the 2025-era `initialize` handshake, which keep working unmodified. stdio serves either era on its connection; HTTP decides per request and stays stateless for both.
- **BREAKING: minimum Node.js version raised from 18 to 20.3** (SDK v2 requires Node 20; aborting upstream calls on cancellation uses `AbortSignal.any`, added in 20.3).
- **BREAKING (HTTP): `GET` and `DELETE` on the MCP endpoint are now answered `405`** (stateless server: no standalone SSE stream, no sessions). Previously a `GET` opened an SSE stream that never ended and a `DELETE` returned `200`.
- HTTP: a malformed or empty JSON body now gets `400` with JSON-RPC parse error `-32700` (a malformed body was a `500`).
- HTTP: CORS now allows the `Mcp-Protocol-Version`, `Mcp-Method` and `Mcp-Name` request headers sent by 2026-07-28 clients.
- Tools and resources no longer advertise `listChanged`: the lists are static and never change, so clients have no reason to keep an idle change-notification stream (`subscriptions/listen`) open.
- Cancelling a request — closing the HTTP response stream, or `notifications/cancelled` on stdio — now aborts the upstream Carbone API call instead of leaving it running until it completes or times out.
- HTTP startup prints a warning when a server-level `CARBONE_API_KEY` is set and `CARBONE_REQUIRE_CLIENT_AUTH_HEADER` is `false`, since requests without a Bearer key then spend that key. The key itself is never printed.
- **BREAKING: output formats synced with the Carbone OpenAPI (v5.15.0) and checked live.** `convertTo` no longer accepts `zip` (batch archives come from `batchOutput`) or `cdr`, and now also accepts `ott`, `ots`, `otp`, `dbf`, `dif`, `emf`, `wmf` and `eps` (36 formats, `doc`/`xls`/`ppt` included). Valid outputs depend on the input format.
- **BREAKING: `egressAuthorization` is limited to 511 characters** (was 512), as the API requires.
- **BREAKING: `update_template_metadata` reports the patched version.** Its text is now "Template metadata updated for version …" (was "Template metadata updated successfully.") and it returns structured output. Moving a version to another Template ID is documented as `moveToTemplateId` (the API's `id` body field); the 1.6.0 parameter `id` is still accepted as a deprecated alias, and passing both with different values is rejected.
- **BREAKING: template inputs follow the API.** `name` is optional on `upload_template`; `name`, `comment` and `category` are limited to 200 characters (upload and update); `sample` takes at most one object, whose keys `data`, `complement`, `translations` and `enum` are all optional (other keys are rejected); `expireAt` must be ≥ 0.
- **BREAKING: error messages changed.** They carry the Carbone API message and its code, e.g. `Document generation failed (Carbone w101): …`, followed by a hint (see Fixed). Library users: a 500 with an API message throws `CarboneGenerationError`, timeouts and network failures throw `CarboneConnectionError` (the original error is in `originalError`), and `CarboneClient.updateTemplate` returns the response data instead of `void`.
- Converter `I` (Carbone ICE) is recommended over `O` for DOCX → PDF, as from Carbone v5.15.0.
- Tool descriptions follow the transport in the tool-level text too (`convert_document`, `render_document`), not only in the parameters, and the server instructions say local paths and `outputPath` work in stdio only.
- Internal: every tool input and output schema is wrapped with `z.object(...)` once, so all tools use the non-deprecated `registerTool` overload; the transport-dependent schemas are built once per transport and cached, not per HTTP request.
- **Docs: claude.ai and Claude Desktop connectors.** The README no longer says only that Claude Desktop "does not support Bearer authentication". Per Anthropic's connector documentation, a custom connector authenticates with OAuth or without authentication, and a fixed API key in a request header is a beta for a limited set of organizations, entered once by an Owner and shared by every member. `mcp.carbone.io` authenticates with a Bearer key, so the README recommends the local package for Claude Desktop and explains the request-header setup (and its shared key) for organizations that have it.
- **Docs: client setup follows each client's documentation.** VS Code uses `.vscode/mcp.json` with `servers`, `"type": "http"` and an input variable for the key (the README showed the settings `mcp.servers` block with `"type": "streamable-http"`); Cursor, Claude Code (stdio and `--transport http --header`) and Claude Desktop snippets are per client; the MCP Inspector command passes the key with `-e` (stdio refuses to start without it) and the UI port is 6274 (was `5173`). The README adds prerequisites (Node.js 20.3+, test vs production API key), a [File inputs](README.md#file-inputs) section and a troubleshooting table.
- stdio: one incoming message may be up to `MCP_MAX_BODY_BYTES` (60 MB by default), the same limit as an HTTP request body. Without this, the SDK would close the session on any message over 10 MB, such as a large inline base64 file.
- HTTP mode, from the MCP SDK: a JSON-RPC batch of more than 100 messages is rejected, and a long-running streamed response carries an SSE keep-alive comment every 15 s.
- HTTP mode: a request body over `MCP_MAX_BODY_BYTES` is answered `413` as soon as the limit is passed, and the connection is closed. The server no longer reads the rest of the body first.
- HTTP mode: error log lines are reduced to printable ASCII, like the access log.
- Dependencies: transitive dependencies updated to patched releases within their existing version ranges.

### Added

- **`inspect_template` tool.** Lists the Carbone tags a template uses and returns a sample JSON dataset matching its structure: `tags` (string[]) and `sample` (`data`, plus `complement` when the template uses `{c.}` tags), with a text summary. Use it before `render_document` when you don't know which data a template expects. Takes exactly one of `templateId` (Template ID or Version ID) or `template` (same forms as `render_document`). It runs one render on your Carbone account (counted like a document generation) and discards the document; `{t()}` translation tags are not listed. Read-only.
- `MCP_ALLOWED_ORIGINS` (HTTP only) — comma-separated browser `Origin` hostnames allowed in addition to `localhost`, `127.0.0.1` and `[::1]` (e.g. `app.example.com`). Hostnames only, without scheme or port; `<scheme>://*` (e.g. `moz-extension://*`) allows a browser-extension scheme. Invalid entries stop the server at startup.
- `render_document`: `failOn` (`["IMAGE_URL_ERROR"]`, Carbone v5.15.0+: fail the render when an image cannot be downloaded from its URL) and `preReleaseFeatureIn`.
- `update_template_metadata`: structured output (`versionId` plus the updated fields echoed by Carbone).
- `upload_template` output: `deployedAt` (`0` = not explicitly deployed), `createdAt`, and `templateExtension` (versioning disabled).
- Error messages include the Carbone API error code (`wNNN`).

### Fixed

- **PDF → PDF now applies `formatOptions`.** In 1.x, asking `convert_document` to password-protect, watermark or convert an existing PDF to PDF/A returned it unchanged and unencrypted, without an error, because the server did not set `hardRefresh` (Carbone re-runs the converter on PDF → PDF when it is set; measured live). The server now sets `hardRefresh` itself when the input is a PDF, `convertTo` is `pdf` and `formatOptions` are given; an explicit `hardRefresh: false` is respected. A plain `"pdf"` target is left alone (the file is returned untouched, as before). The `hardRefresh` description says when it is needed.
- **`convert_document` `reportName` now takes effect.** Carbone resolves `reportName` during templating, which a pure conversion skips, so the file was named `report.<ext>`. The server now names the delivered file `<reportName>.<ext>` itself (attachment name, and the default saved file name in stdio). Same for `render_document` with `keepTags`.
- **Carbone ICE applies PDF Security and Watermark options.** The 1.6.0 descriptions said `converter: "I"` ignored passwords and permissions. ICE applies the Security options (`EncryptFile`, `DocumentOpenPassword`, `RestrictPermissions`, …) and `Watermarks`; PDF/A, page ranges, accessibility and the other PDF options use `L`. Tool descriptions and docs are corrected, ODT is listed as an ICE input, and the ICE limitations now follow [Carbone's documentation](https://carbone.io/documentation/developer/http-api/generate-reports.html#converters-carbone-ice-limitations).
- **Wrong deletion guidance.** The tools said `expireAt = 42000000000` deletes a template immediately; that "now" value only exists for `deployedAt`, so following the advice scheduled the deletion far in the future (timestamp 42000000000) instead of now. `delete_template` takes effect immediately; `expireAt` schedules a deletion (`0` = never; on update, `0` cancels one).
- `update_template_metadata` with a Template ID patches only the currently deployed version; it was described as updating all versions.
- `download_template` over HTTP: the `outputPath` description offered `returnLink`, which that tool does not have; it now names `asAttachment` only.
- `formatOptions` examples used keys the API does not have (`DocumentPermissionPassword`, `fontsize`, `ConvertSlideshow`, `density`) and allowed 5 watermarks (the maximum is 4). They now use the API's keys: `RestrictPermissions` + `PermissionPassword`, `size`, `PixelWidth` / `PixelHeight`, …
- Converter guidance follows Carbone's documentation, and the converter applies whenever the format changes (not only for PDF).
- Batch guidance: `batchReportName` examples no longer include an extension (Carbone appends it), and the "zip with `batchSplitBy`" advice is gone.
- Async (webhook) guidance: the tool returns only Carbone's acceptance message; the webhook receives `{ success, data: { renderId } }` and its server downloads the document from `GET /render/{renderId}`. `returnLink` is ignored when `webhookUrl` is set.
- 500 render errors (`w101`, `w117`) were reported as a Carbone outage, so agents retried deterministic template, data or format errors. They now read "Document generation failed" with a hint (e.g. the conversion matrix); "temporarily unavailable, try again" is kept for a 500 without message and for 502–504.
- 401 advice always pointed to `CARBONE_API_KEY`, even in HTTP mode; it now matches the transport (`Authorization: Bearer <key>` in HTTP). 400, 413 and 422 errors keep the API's detail.
- Timeouts and network failures read "Unexpected error: …"; they now read "Carbone API request timed out after N s." and "Could not reach the Carbone API at <host>: <code>." (never the key or headers).
- Input formats are listed once, the same for every file/template parameter and `get_capabilities`: DOCX, XLSX, PPTX, ODT, ODS, ODP, ODG, HTML, XHTML, XML, SVG, IDML, MD, TXT, CSV, RTF, PDF. `convert_document` no longer lists PNG and JPG as inputs. Stale documentation links are updated; `get_capabilities` builds its output format list from the code.
- **Template syntax examples corrected (tool descriptions and docs).** `{d.total:formatC(EUR)}` passed `EUR` as the first argument of `formatC(precisionOrFormat, targetCurrency)`; examples now use `formatC()`, formatted per `lang` and converted from `currencySource` to `currencyTarget`. Aliases were shown as computed expressions (`{#total = d.price * d.qty}`): an alias is a shortcut, defined with `{#alias = d.path}` (also in `variableStr`) and used with `{$alias}`. Conditions use `ifEQ(…):show(…):elseShow(…)` rather than a ternary, and `showEnd` closes a block without repeating the condition.
- **Examples use accepted file forms.** A bare file name (`report.docx`, `clients.json`) is neither a URL nor a path, so it is read as base64; examples now use an absolute path (stdio) or a URL, and the docs list the accepted forms.
- **`server.json`: registry clients were not told the hosted server needs a key.** `remotes[].authentication` is not part of the registry schema (2025-12-11) and was dropped on publish, so the registry entry for `https://mcp.carbone.io` declared no credential. The remote now declares an `Authorization` header (`isRequired`, `isSecret`, placeholder `Bearer <your Carbone API key>`), so registry clients ask for it.
- Docs: dead link to the template syntax guide replaced; the Docker Hub tag examples name a published version.

### Security

- **URL inputs could reach internal addresses (critical, HTTP mode).** The private-network guard on URL inputs (`template`, `file`, and the by-reference JSON params such as `data`) did not recognise some IPv6 notations of internal addresses, including IPv4 addresses written inside an IPv6 address, and a hostname could be validated against one DNS answer and then connected using another (DNS rebinding). Every IPv4 and IPv6 notation is now checked on the address itself, and the check runs on the exact address the connection uses. Redirects are still re-checked at every hop. `CARBONE_ALLOW_PRIVATE_NETWORK=true` keeps its meaning.
- **Unauthenticated HTTP requests could trigger URL downloads (medium, HTTP mode).** `render_document`, `convert_document` and `upload_template` downloaded their URL inputs before checking whether the caller had an API key. They now check credentials first (as does the new `inspect_template`): a call without an API key (where one is required) fails before anything is downloaded. Authenticated calls are unchanged.
- **Error messages could echo remote content (medium).** A failed download repeated the remote server's status text, and an invalid JSON input repeated part of the content it had fetched or read. Errors now report only the HTTP status code, a fixed error code, or a fixed message, so nothing chosen by a remote server is passed back to the assistant.
- **Downloads are size-capped while they stream.** A response without a `Content-Length` (or with a wrong one) was held in memory in full before the `CARBONE_MAX_FILE_BYTES` check. The download now stops as soon as the limit is passed.
- **`outputPath` could overwrite existing files (medium, stdio).** Saving a document replaced any file already at that path, and followed symbolic links. A path that already exists is now refused with a message asking for a new file name. New files are readable by your user only (`0600`). The default temp-file output (no `outputPath`) now writes each document to its own new private folder, so it never replaces or follows anything already in the temp directory.
- **The read-only hint was wrong over stdio.** `render_document`, `convert_document` and `download_template` were marked read-only, but over stdio they write files to disk. They now report `readOnlyHint: false` (not destructive, not idempotent) over stdio, so clients that ask for confirmation before writing tools behave as expected. HTTP is unchanged (read-only, since nothing is written there).
- **Docker quick starts no longer create an open shared-key server (docs, `compose.yml`).** The README, the Docker Hub page and `compose.yml` set a server-level `CARBONE_API_KEY` and published the port on every interface with client authentication off, so anyone who could reach the port spent that key. The quick starts now set no server key (each client sends its own `Authorization: Bearer <key>`) and publish `127.0.0.1:3000` only; the shared-key setup is a separate, labelled variant with its risk. **BREAKING (`compose.yml`): the port is published on `127.0.0.1` only**; edit the `ports` line to serve other machines, preferably behind a TLS reverse proxy. `compose.yml` also passes through every variable of `.env.example` (it lacked `CARBONE_MAX_FILE_BYTES`, `CARBONE_REQUIRE_CLIENT_AUTH_HEADER`, `CARBONE_ALLOW_PRIVATE_NETWORK`, `MCP_MAX_BODY_BYTES` and `MCP_ALLOWED_ORIGINS`, and fixed `MCP_PATH` to `/`).
- **Origin validation on the HTTP MCP endpoint (BREAKING for browser-based clients).** As the 2026-07-28 spec requires, a request whose `Origin` header is present but not allowed is now rejected with `403` before anything runs, so a malicious web page cannot reach a locally running server (DNS rebinding) and spend its key. Allowed by default: `localhost`, `127.0.0.1`, `[::1]`, on any port. **Browser-based clients served from any other origin get `403` until their hostname is listed in `MCP_ALLOWED_ORIGINS`.** Requests without an `Origin` header — desktop, CLI and server-side clients — are unaffected.
- `npm audit` reports 0 vulnerabilities. The v1 SDK advisory GHSA-6qxp-vccf-f47h (high, OAuth client) no longer applies: the server now uses the v2 SDK packages, which are not affected. Dev only: `vitest` / `@vitest/mocker` GHSA-82fw-gwwq-j7x9 (moderate) — `vitest` and `@vitest/coverage-v8` bumped to 4.1.11.

---

## [1.6.0] — 2026-08-19

### Added

- **Carbone ICE converter** — `converter: "I"` on `render_document` and `convert_document` (Carbone API v5.14.0). Carbone's own DOCX → PDF engine, up to 60x faster than LibreOffice on a 1000-page DOCX. **DOCX → PDF only**; any other input or output format is rejected.

  ⚠️ **ICE silently ignores PDF security options.** `EncryptFile`, `DocumentOpenPassword` and `RestrictPermissions` are accepted but never applied — the PDF comes back readable by anyone, with no error. Only `Watermarks` work. Use `L` whenever a password or restricted permissions are required.

  Also unsupported: WEBP and EMF/WMF images, table of contents, SmartArt, complex charts, footnotes/endnotes, comments, tracked changes, form fields, equations, bookmarks and links. A missing font falls back to Noto Sans.

- `render_document` — `keepTags` skips templating and leaves every tag as literal text (`{d.customer}` stays `{d.customer}`). Use it to proof a stored template by `templateId`. Rejected together with `data`.

- `convert_document` — `reportName` (output filename, extension appended by Carbone) and `hardRefresh` (forces the converter to run when the output format equals the input format — needed for PDF → PDF so `formatOptions` such as watermark, password and PDF/A actually apply).

- `convert_document` / `render_document` — `doc`, `xls` and `ppt` added as output formats. Carbone writes the legacy binary Office formats even though it cannot read them back, so they are output-only (all three verified against the API).

- `convert_document` — corrected the input format list. Carbone reads XML-based and text-based documents only, so the legacy binary formats `DOC`, `XLS` and `PPT` are rejected as input (`w118`) even though Carbone can produce them as output; `RTF` and `PDF` are accepted. Conversion and templating share one endpoint and one validation, so their accepted inputs are identical.

- `render_document` — `batchOutput` now accepts `"pdf"` (concatenates the batch into one continuous PDF; requires `convertTo: "pdf"`) alongside `"zip"`. `batchSplitBy` accepts `"d"` when the data itself is the array. Carbone Cloud allows 1–100 objects per batch.

- `download_template` — `sample: true` returns the JSON sample dataset stored with the template (`GET /template/{id}_sample.json`) instead of the template file. Sample data could be uploaded but never read back.

- `update_template_metadata` — `id` moves a version under a different Template ID.

- `list_templates` — the `origin` filter documents all five values: 0 = API, 1 = Studio, 2 = Salesforce, 3 = Odoo, 4 = HubSpot (only 0 and 1 were listed).

### Changed

- **Tool descriptions now follow the transport.** Over HTTP they no longer offer "local file path" as an input form — those have been rejected since 1.5.0, so the model was being told about a call that could only fail — and `outputPath` is marked unavailable with `asAttachment` / `returnLink` named instead. stdio wording is unchanged.

- **`convert_document` now preserves Carbone tags.** It previously sent `data: {}`, which ran templating against an empty dataset and blanked every tag — so converting a DOCX template to PDF silently destroyed every `{d.field}`. The field is now omitted entirely, which skips templating (Carbone 5.9.0+). Conversion changes a document's format; it does not template. Use `render_document` to resolve tags.

---

## [1.5.0] — 2026-06-26

### Security

- **Fixed SSRF (critical, HTTP mode).** User-supplied URLs were fetched server-side with no destination validation, letting a caller reach internal services, `localhost`, and cloud metadata (`169.254.169.254`) — and read the response back via `download_template`, `convert_document`, or a render. URLs are now resolved and rejected when they point at loopback, private (RFC1918), link-local, CGNAT, multicast or reserved addresses, for both IPv4 and IPv6. **Every redirect hop is re-validated**, so an allowed host cannot bounce into internal space, and non-`http(s)` redirect targets are rejected. Affected `upload_template`, `render_document`, `convert_document`, and the by-reference JSON params (`data`, `complement`, `translations`, `enum`, `currencyRates`). Set `CARBONE_ALLOW_PRIVATE_NETWORK=true` to allow internal hosts on a trusted deployment.
- **Fixed arbitrary local file read (critical, HTTP mode).** Local filesystem paths were resolved with no transport gate, so a remote caller could make the server read its own disk (e.g. `/proc/self/environ`, leaking the operator's `CARBONE_API_KEY`). Reading local paths is now restricted to stdio, where the server already runs as the caller. Not reported in the original disclosure — found while auditing it.
- **Hardened template ID handling.** `templateId` / `versionId` are now URL-encoded before being interpolated into Carbone API paths, so a crafted value can no longer reshape the request path or query.

Thanks to [nickelsec](https://github.com/nickelsec) for responsibly disclosing the SSRF vulnerability.

### Changed

- **Documented the shared-key trade-off.** `CARBONE_REQUIRE_CLIENT_AUTH_HEADER` still defaults to `false`, and that default is unchanged: in HTTP mode with a server-level `CARBONE_API_KEY` set, a request without a Bearer key falls back to that key, so anyone who can reach the port can spend that Carbone account. That is a deliberate deployment choice (and is irrelevant when no server key is set — e.g. on-premise Carbone without authentication), so it is now spelled out where it is configured: README, `docs/API.md`, `docs/DOCKER_HUB.md` and `.env.example`. Set it to `true` to require every client to bring its own key.

### Added

- `CARBONE_ALLOW_PRIVATE_NETWORK` (default `false`) — allow user-supplied URLs to resolve to private/internal addresses. Only enable on a trusted deployment (e.g. an internal template host).

---

## [1.4.0] — 2026-06-26

### Added

- `render_document` and `convert_document` — new `egressAuthorization` parameter sets Carbone's `carbone-egress-header-authorization` header (Carbone API v5.9.0), authorizing Carbone's **outbound** requests while rendering/converting: external images (`{d.imageUrl}`), external PDFs (`:appendFile` / `:attachFile`), and webhooks. Max 512 characters; only the `authorization` header is customizable. For webhook calls, `webhookHeaders.authorization` overrides it.

### Changed

- `render_document` — `data` is now optional. When omitted it defaults to `{}` (the template is converted without data injection — e.g. to convert a stored template by `templateId`). The `data` field is always sent to the API, so existing v5 behavior is unchanged (templating is not skipped).

---

## [1.3.0] — 2026-06-24

### Added

- `render_document` — `data`, `complement`, `translations`, `enum`, and `currencyRates` can now be passed **by reference** as a string (a local file path in stdio mode, an HTTPS URL, or a base64-encoded JSON string) in addition to inline JSON. Large datasets and translation maps no longer have to be inlined into the tool call. A string is always treated as a reference; inline JSON is still passed as an object/array.
- `render_document` — `data` now also accepts a **top-level JSON array** (rendered with `{d[i].field}` loops), not just an object.

### Fixed

- `get_capabilities` listed unsupported PDF conversions (PDF → DOCX/TXT) and omitted PDF → image. Corrected to the supported set: a PDF converts to an image (PNG/JPG/WEBP/GIF/TIFF/BMP), to ODT, or re-saved as PDF.

### Changed

- Documentation accuracy pass across README, `docs/API.md`, `docs/DOCKER_HUB.md`, and the MCP specification: documented output delivery (`outputPath` / `asAttachment` / `returnLink`) and the binary-delivery model, added the `CARBONE_MAX_FILE_BYTES` and `CARBONE_REQUIRE_CLIENT_AUTH_HEADER` environment variables, corrected stale health-check version examples, and documented the PDF→image capability.

---

## [1.2.2] — 2026-06-22

### Changed

- Server instructions and `get_capabilities` now reference Carbone documentation as Markdown (`.md`) instead of HTML, and surface the `llms.txt` / `llms-full.txt` indexes — cutting the token cost when the model fetches a doc page
- The initial instructions now point to the Carbone Skill as the source of truth for templating syntax, and warn that Carbone tags are a unique language.
- Docker base image upgraded from `node:24-alpine` to `node:26-alpine`

### Fixed

- Corrected a dead documentation link (MCP docs: `…/developer/mcp/introduction.html` → `…/developer/ai/mcp.md`)

---

## [1.2.1] — 2026-06-22

### Fixed

- Binary documents (PDF, Office, ZIP, …) are no longer returned as inline `image` blocks. Some clients (e.g. Claude Desktop) mis-routed a PDF into an image block and rejected it with `image.source.media_type: Input is not one of the permitted values`, crashing the render. Only true inline-renderable formats (text and `png`/`jpeg`/`gif`/`webp`) are now inlined; everything else is saved to a local temp file in stdio mode (path returned) or returned as a download attachment in HTTP mode. `svg`/`tiff`/`bmp` now return as attachments rather than inline images.

### Added

- `returnLink` on `convert_document` and `render_document` — return Carbone's public one-time download URL (`<API URL>/render/{renderId}`) instead of the bytes. The result clearly instructs that the link is short-lived and consumed by the first download, so the model hands it to the user rather than fetching it.

---

## [1.2.0] — 2026-06-22

### Added

- `outputPath` on `convert_document`, `render_document`, and `download_template` (stdio mode) — save the output to a local file instead of returning it inline
- Structured tool output (`outputSchema` + `structuredContent`) for `list_templates`, `list_categories`, `list_tags`, `upload_template`, and `get_api_status`, plus tool titles and behavior annotations (read-only / destructive / idempotent hints)
- Server logo, description, and usage instructions advertised at initialization
- `CARBONE_REQUIRE_CLIENT_AUTH_HEADER` — reject HTTP requests without a Bearer key instead of falling back to the server-level `CARBONE_API_KEY`
- `CARBONE_MAX_FILE_BYTES` — size guard for resolved input files (default 100 MB); `cdr` output format and `idml` / `epub` / `cdr` MIME types
- `Retry-After` now surfaced on 429 rate-limit errors
- `carbone://templates/{id}` resource template — fetch one template (with version history) by Template ID or Version ID, with Template ID autocompletion (MCP completions)

### Fixed

- HTTP multi-tenant: resources (`carbone://templates`, `carbone://categories`, `carbone://tags`) now forward the per-request API key instead of failing authentication
- URL-based file inputs could hang indefinitely — downloads now time out
- `list_templates` — `limit` is now validated against the Carbone maximum (1–100) and rejected client-side instead of producing a failed API call
- `carbone://templates` resource — description no longer advertises query-string filters (unsupported on MCP resources); filtering/search/pagination is directed to the `list_templates` tool

### Changed

- `list_templates`, `list_categories`, `list_tags`, and the `carbone://` resources now return compact JSON (lower token cost)
- Authentication error messages are transport-aware (Bearer token vs environment variable)

---

## [1.1.4] — 2026-05-12

### Changed

- `@types/node` upgraded from 25.6.0 to 25.9.3
- `@vitest/coverage-v8` upgraded from 4.1.5 to 4.1.8
- `vitest` upgraded from 4.1.5 to 4.1.8
- `tsx` upgraded from 4.21.0 to 4.22.4
- Apache-2.0 LICENSE text replaced with canonical SPDX wording (fixes GitHub license detection)
- `get_capabilities` — Carbone Skill platform list replaced with a reference to the Agent Skills standard (agentskills.io), covering all compatible AI assistants without listing specific tools

---

## [1.1.3] — 2026-05-12

### Added

- `.env.example` — environment variable reference file with all supported variables and defaults
- `compose.yml` — `MCP_PORT` now controls both the host and container port mapping (default: `3000`)
- `list_templates` — pagination now fully supported: `hasMore` and `nextCursor` are read from the API response and surfaced to the LLM with a clear next-page instruction

### Fixed

- `list_templates` — `hasMore` and `nextCursor` fields from the API response were previously discarded; the LLM had no way to detect or navigate beyond the first page of results

---

## [1.1.2] — 2026-05-06

### Added

- Claude Code plugin support (`.claude-plugin/plugin.json`) — install via `/plugin install carboneio/carbone-mcp`. Prompts for API key at install time (stored in system keychain). Automatically installs the `carbone-skill` dependency for full templating syntax support.

### Changed

- All `package.json` dependency versions pinned to exact versions (no `^`)
- `vitest` and `@vitest/coverage-v8` upgraded from 4.1.4 to 4.1.5
- `typescript` upgraded from 6.0.2 to 6.0.3
- `zod` upgraded from 4.3.6 to 4.4.3

---

## [1.1.1] — 2026-04-10

### Added

- `get_capabilities` — async/webhook rendering documentation, `outputType` parameter, Common Use Cases, LLM authoring guidance (HTML, Office files), and Carbone Skill reference (GitHub repo + download)
- `get_capabilities` — MCP server documentation link
- HTTP server — `Authorization` header now accepted without `Bearer` prefix; `Bearer` matching is case-insensitive

### Changed

- `get_api_status` — response format simplified
- Carbone Skill download URL points to GitHub Releases
- `vitest`, `@vitest/coverage-v8` upgraded to 4.1.4; `@types/node` to 25.6.0

---

## [1.1.0] — 2026-03-31

### Added

- `render_document` — async rendering via webhook: new `webhookUrl` and `webhookHeaders` parameters. When `webhookUrl` is set, Carbone renders asynchronously and POSTs `{ "data": { "renderId": "..." } }` to the provided URL when the document is ready. Required for batch generation (`batchSplitBy`).
- Docker Compose support (`compose.yml`)
- On-premise installation section in README

### Fixed

- Unhandled rejection crash when an HTTP request arrived with a malformed URL (e.g. `OPTIONS *`) — now returns `400 Bad Request`
- Public static directory failing to load on startup
- Authentication and MCP registry verification
- CI test pipeline configuration
- Docker deployment configuration
- npm publish workflow skipping correctly on `workflow_dispatch`
- ReDoS vulnerability in `path-to-regexp` transitive dependency

### Changed

- Maximum HTTP request body size raised from 10 MB to 60 MB (matches Carbone Cloud upload limit), configurable via `MCP_MAX_BODY_BYTES`
- `@modelcontextprotocol/sdk` upgraded from 1.27.1 to 1.29.0
- `vitest` and `@vitest/coverage-v8` upgraded from 4.1.0 to 4.1.2
- TypeScript upgraded from 5.9.3 to 6.0.2 (added `"types": ["node"]` to `tsconfig.json`)
- Docker run example now explicitly sets `-e MCP_TRANSPORT=http`
- `package.json` homepage updated to the dedicated MCP documentation page

---

## [1.0.1] — 2026-03-25

### Fixed

- `package.json` metadata corrections for npm publishing

---

## [1.0.0] — 2026-03-25

Initial public release.

### Added

- **11 tools** — `render_document`, `convert_document`, `upload_template`, `list_templates`, `update_template_metadata`, `delete_template`, `download_template`, `list_categories`, `list_tags`, `get_api_status`, `get_capabilities`
- **4 resources** — `carbone://templates`, `carbone://categories`, `carbone://tags`, `carbone://status`
- **stdio transport** — compatible with Claude Desktop, Cursor, VS Code, Claude Code, and all MCP-compatible AI clients
- **HTTP transport** (`MCP_TRANSPORT=http`) — self-hosted streamable-HTTP server for team deployments
- Hosted endpoint at `https://mcp.carbone.io` (no local installation required)
- Per-request API key auth via `Authorization: Bearer` header (HTTP mode)
- Health check endpoint (`GET /health`) — unauthenticated, with 30 s result cache
- On-premise support via `CARBONE_BASE_URL` (no API key required)
- Batch document generation (`batchSplitBy`, `batchOutput`, `batchReportName`)
- Advanced PDF options — watermarks, passwords, PDF/A compliance, page ranges
- Multi-language rendering (`lang`, `translations`)
- Currency conversion (`currencySource`, `currencyTarget`, `currencyRates`)
- Timezone-aware date formatting (`timezone`)
- Template versioning, categorization, and tagging
- CI — automated test pipeline and npm publish workflow

[2.1.0]: https://github.com/carboneio/carbone-mcp/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/carboneio/carbone-mcp/compare/v1.6.0...v2.0.0
[1.6.0]: https://github.com/carboneio/carbone-mcp/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/carboneio/carbone-mcp/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/carboneio/carbone-mcp/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/carboneio/carbone-mcp/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/carboneio/carbone-mcp/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/carboneio/carbone-mcp/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/carboneio/carbone-mcp/compare/v1.1.4...v1.2.0
[1.1.4]: https://github.com/carboneio/carbone-mcp/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/carboneio/carbone-mcp/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/carboneio/carbone-mcp/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/carboneio/carbone-mcp/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/carboneio/carbone-mcp/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/carboneio/carbone-mcp/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/carboneio/carbone-mcp/releases/tag/v1.0.0