#!/usr/bin/env node
import { createRequire } from 'module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CarboneClient } from './carbone/client.js';
import { loadConfig } from './server/config.js';
import { startHttpServer } from './server/http.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { serverInfo, SERVER_INSTRUCTIONS } from './server/serverInfo.js';

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
    await startHttpServer({ client, version, port: config.port, mcpPath: config.mcpPath, maxBodyBytes: config.maxBodyBytes, maxFileBytes: config.maxFileBytes });
    return;
  }

  // stdio mode (default) — one server, one client, key from env var
  const server = new McpServer(serverInfo(version), { instructions: SERVER_INSTRUCTIONS });
  // stdio runs locally, so writing outputPath files to disk is meaningful.
  registerTools(server, client, { allowFileOutput: true, maxFileBytes: config.maxFileBytes });
  registerResources(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

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
