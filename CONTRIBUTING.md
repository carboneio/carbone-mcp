# Contributing to Carbone MCP

Thank you for your interest in contributing! This document covers how to get started.

## Development Setup

```bash
git clone https://github.com/carboneio/carbone-mcp
cd carbone-mcp
npm install
npm run dev    # Run with tsx (no build needed)
```

## Running Tests

```bash
npm test                  # Unit tests (no API key needed)
npm run test:watch        # Watch mode
npm run test:coverage     # Coverage report
npm run test:integration  # Real API tests (requires CARBONE_TEST_API_KEY)
```

All pull requests must pass the unit test suite. New features must include tests.

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