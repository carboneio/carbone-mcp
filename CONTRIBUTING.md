# Contributing to Carbone MCP

Thank you for your interest in contributing! This document covers how to get started.

## Development Setup

Requires Node.js 20.3 or later (`engines` in `package.json`).

```bash
git clone https://github.com/carboneio/carbone-mcp
cd carbone-mcp
npm install
npm run dev    # Run with tsx (no build needed)
npm run build  # Compile TypeScript to dist/
```

## Running Tests

```bash
npm test                  # All tests (the real-API e2e tests run only with CARBONE_TEST_API_KEY)
npm run test:unit         # Unit tests only (no API key needed)
npm run typecheck         # Type-check without emitting
npm run test:watch        # Watch mode
npm run test:coverage     # Coverage report
npm run test:integration  # Integration tests (e2e against the real API needs CARBONE_TEST_API_KEY)
```

All pull requests must pass the unit test suite. New features must include tests.

## Debugging

The [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) (Node.js 22.19 or later) lets you list the tools, call them and read each request and response, without an AI client:

```bash
# Published package
npx @modelcontextprotocol/inspector -e CARBONE_API_KEY=your_api_key_here npx carbone-mcp

# Local build (run npm run build first)
npx @modelcontextprotocol/inspector -e CARBONE_API_KEY=your_api_key_here node dist/index.js

# A running HTTP server
npx @modelcontextprotocol/inspector --server-url http://localhost:3000 --transport http --header "Authorization: Bearer your_api_key_here"
```

The Inspector opens its web UI in your browser (port `6274` by default; the printed URL carries a per-launch session token).

The server writes its diagnostics to stderr. Claude Desktop saves them in `mcp-server-carbone.log`, next to its own `mcp.log` (macOS: `~/Library/Logs/Claude/`, Windows: `%APPDATA%\Claude\logs\`):

```bash
tail -n 20 -f ~/Library/Logs/Claude/mcp*.log
```

A successful start logs `Carbone MCP Server v<version> started (stdio)`, then the Carbone API URL and the skills served (`Skills: carbone@x.x.x`, or `none`). In HTTP mode, `GET /health` reports the server and Carbone API status ([Health endpoint](docs/API.md#health-endpoint)).

## Updating the Carbone Skill

`skills/carbone/` is a copy of a [carbone-agent-plugin](https://github.com/carboneio/carbone-agent-plugin) release, served over MCP (`src/server/skills.ts`). It is committed so that every build (CI, Docker, a self-hosted build behind a proxy, a source ZIP) works without downloading it. Never edit it by hand: change the skill in carbone-agent-plugin, release it, then:

```bash
npm run skill:sync -- x.x.x   # download vx.x.x's carbone.skill, replace skills/carbone/, pin it in skills.lock.json
npm run skill:check           # what CI runs: the folder must match the pinned release, byte for byte
```

Commit `skills/` and `skills.lock.json` together. A skill change reaches users with the next carbone-mcp release, and MCP clients ask them to approve the changed skill again, so ship it on purpose. `agents/openai.yaml` (Codex display metadata) is left out.

## Code Style

- TypeScript strict mode — no `any` unless unavoidable
- ESM imports with `.js` extensions (`import { foo } from './bar.js'`)
- Zod schemas in `src/validation/schemas.ts` for input validation
- Tool handlers in `src/tools/` — one file per domain
- Client HTTP calls in `src/carbone/client.ts` only
- Keep tool descriptions accurate and LLM-friendly

## Pull Request Process

1. Fork the repository and create a feature branch
2. Write or update tests for your changes
3. Run `npm test` and ensure all tests pass
4. Run `npm run build` and ensure TypeScript compiles cleanly
5. Open a pull request with a clear description of what and why

## Reporting Bugs

Open an issue at [github.com/carboneio/carbone-mcp/issues](https://github.com/carboneio/carbone-mcp/issues) with:
- Steps to reproduce
- Expected vs. actual behavior
- MCP client and Node.js version

## Suggesting Features

Open an issue with the `enhancement` label. Describe the use case and why it belongs in this MCP server.