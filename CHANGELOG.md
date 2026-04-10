# Changelog

All notable changes to this project will be documented in this file.

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

[1.1.1]: https://github.com/carboneio/carbone-mcp/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/carboneio/carbone-mcp/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/carboneio/carbone-mcp/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/carboneio/carbone-mcp/releases/tag/v1.0.0