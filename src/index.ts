#!/usr/bin/env node
import { createRequire } from 'module';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { McpServer } from '@modelcontextprotocol/server';
import { CarboneClient } from './carbone/client.js';
import { loadConfig } from './server/config.js';
import { startHttpServer } from './server/http.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { serverInfo, SERVER_OPTIONS } from './server/serverInfo.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

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
      process.stderr.write(
        '[carbone-mcp] Warning: requests without an Authorization: Bearer key use the server-level CARBONE_API_KEY. ' +
        'Set CARBONE_REQUIRE_CLIENT_AUTH_HEADER=true to require every client to send its own key.\n'
      );
    }
    await startHttpServer({ client, version, port: config.port, mcpPath: config.mcpPath, maxBodyBytes: config.maxBodyBytes, maxFileBytes: config.maxFileBytes, allowPrivateNetwork: config.allowPrivateNetwork, allowedOriginHostnames: config.allowedOriginHostnames, openAiAppsChallenge: config.openAiAppsChallenge, oauth: config.oauth });
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

main().catch((error) => {
  process.stderr.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  process.stderr.write(
    `[carbone-mcp] Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}\n`
  );
  process.exit(1);
});
