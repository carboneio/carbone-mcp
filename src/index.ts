#!/usr/bin/env node
import { createRequire } from 'module';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { McpServer } from '@modelcontextprotocol/server';
import { CarboneClient } from './carbone/client.js';
import { loadConfig } from './server/config.js';
import { startHttpServer } from './server/http.js';
import { exitWhenFlushed, log } from './server/log.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { serverInfo, SERVER_OPTIONS } from './server/serverInfo.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };
/** HTTP mode logs logfmt lines (src/server/log.ts), stdio mode plain text. Read from the environment: a bad configuration fails in loadConfig. */
const httpMode = process.env['MCP_TRANSPORT'] === 'http';

/** HTTP mode: a fatal error on one line, with its stack's first frames (log() keeps 300 characters). */
function logFatal(msg: string, error: unknown): void {
  const err = error instanceof Error ? error : undefined;
  log('error', { msg, error: err?.message ?? String(error), stack: err?.stack?.split('\n').slice(1).map((frame) => frame.trim()).join(' | ') });
}

async function main() {
  const config = loadConfig();

  const client = new CarboneClient({
    apiKey: config.carboneApiKey,
    baseUrl: config.carboneBaseUrl,
    timeout: config.timeout,
    transport: config.transport,
    requireClientAuth: config.requireClientAuth,
  });

  if (config.transport === 'http') {
    if (config.carboneApiKey && !config.requireClientAuth) {
      log('warn', {
        msg: 'requests without an Authorization: Bearer key use the server-level CARBONE_API_KEY',
        hint: 'Set CARBONE_REQUIRE_CLIENT_AUTH_HEADER=true to require every client to send its own key.',
      });
    }
    await startHttpServer({ client, version, port: config.port, mcpPath: config.mcpPath, maxBodyBytes: config.maxBodyBytes, maxFileBytes: config.maxFileBytes, allowPrivateNetwork: config.allowPrivateNetwork, allowedOriginHostnames: config.allowedOriginHostnames, openAiAppsChallenge: config.openAiAppsChallenge, museChallenge: config.museChallenge, oauth: config.oauth, tickets: config.tickets, jobStore: config.jobStore });
    return;
  }

  // stdio mode (default) — one client, key from env var. serveStdio serves both 2026-07-28 and
  // 2025-era (initialize) clients, calls the factory for each server instance it needs, and closes
  // when stdin ends so the process exits.
  serveStdio(() => {
    const server = new McpServer(serverInfo(version), SERVER_OPTIONS);
    // stdio runs locally, so writing outputPath files to disk is meaningful.
    // stdio runs locally as the caller, so reading/writing local paths is the documented behavior.
    registerTools(server, client, {
      allowFileOutput: true,
      allowFileInput: true,
      allowPrivateNetwork: config.allowPrivateNetwork,
      maxFileBytes: config.maxFileBytes,
    });
    registerResources(server, client);
    return server;
  }, {
    // The SDK caps one stdio message at 10 MB (STDIO_DEFAULT_MAX_BUFFER_SIZE) and closes the session past it.
    // Use the same limit as an HTTP request body instead, so an inline base64 file accepted over HTTP works here too.
    transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: config.maxBodyBytes }),
    onerror: (error) => process.stderr.write(`[carbone-mcp] MCP error: ${error.message}\n`),
  });

  // MCP servers communicate over stdio — use stderr for diagnostic messages
  // so they don't interfere with the MCP protocol on stdout.
  process.stderr.write(`Carbone MCP Server v${version} started (stdio)\n`);
  process.stderr.write(`Carbone API: ${config.carboneBaseUrl}\n`);
}

// Exits once the line is written: to a pipe, stderr is asynchronous.
main().catch((error) => {
  if (httpMode) logFatal('fatal error', error);
  else process.stderr.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
  exitWhenFlushed(1);
});

process.on('unhandledRejection', (reason) => {
  if (httpMode) logFatal('unhandled rejection', reason);
  else process.stderr.write(`[carbone-mcp] Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}\n`);
  exitWhenFlushed(1);
});
