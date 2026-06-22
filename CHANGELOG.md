# Changelog

All notable changes to this project will be documented in this file.

---

## [Unreleased]

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

[1.2.1]: https://github.com/carboneio/carbone-mcp/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/carboneio/carbone-mcp/compare/v1.1.4...v1.2.0
[1.1.4]: https://github.com/carboneio/carbone-mcp/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/carboneio/carbone-mcp/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/carboneio/carbone-mcp/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/carboneio/carbone-mcp/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/carboneio/carbone-mcp/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/carboneio/carbone-mcp/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/carboneio/carbone-mcp/releases/tag/v1.0.0