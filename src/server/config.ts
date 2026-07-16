import { CarboneClient } from '../carbone/client.js';

export type TransportMode = 'stdio' | 'http';

export interface ServerConfig {
  carboneApiKey: string | undefined;
  carboneBaseUrl: string;
  timeout: number;
  transport: TransportMode;
  port: number;
  mcpPath: string;
  maxBodyBytes: number;
  maxFileBytes: number;
  requireClientAuth: boolean;
  allowPrivateNetwork: boolean;
}

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ${name} value "${value}". Must be a positive integer.`);
  }
  return n;
}

function parseBool(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === '') return fallback;
  if (value !== 'true' && value !== 'false') {
    throw new Error(`Invalid ${name} value "${value}". Must be "true" or "false".`);
  }
  return value === 'true';
}

export function loadConfig(): ServerConfig {
  const apiKey = process.env['CARBONE_API_KEY'] || undefined;
  const baseUrl = process.env['CARBONE_BASE_URL'] ?? CarboneClient.CLOUD_API_URL;
  const transport = (process.env['MCP_TRANSPORT'] ?? 'stdio') as TransportMode;

  if (transport !== 'stdio' && transport !== 'http') {
    throw new Error(`Invalid MCP_TRANSPORT value "${transport}". Must be "stdio" or "http".`);
  }

  // API key is only required in stdio mode when targeting the Carbone cloud API.
  // - On-premise deployments (custom CARBONE_BASE_URL) run without authentication.
  // - In HTTP mode, each client can supply its own key via the Authorization: Bearer header,
  //   so a server-level key is optional.
  if (!apiKey && baseUrl === CarboneClient.CLOUD_API_URL && transport === 'stdio') {
    throw new Error(
      'CARBONE_API_KEY environment variable is required for the Carbone cloud API.\n' +
      'Get your API key from: https://account.carbone.io\n' +
      'For on-premise deployments, set CARBONE_BASE_URL to your server URL.\n' +
      'For HTTP mode, you can omit CARBONE_API_KEY and pass keys per-request via Authorization: Bearer.'
    );
  }

  const mcpPath = process.env['MCP_PATH'] ?? '/';
  if (!mcpPath.startsWith('/')) {
    throw new Error(`Invalid MCP_PATH value "${mcpPath}". Must start with "/".`);
  }
  if (mcpPath === '/health') {
    throw new Error('Invalid MCP_PATH value "/health". This path is reserved for the health check endpoint.');
  }

  return {
    carboneApiKey: apiKey,
    carboneBaseUrl: baseUrl,
    // Carbone API maximum timeout is 60 seconds
    timeout: parsePositiveInt(process.env['CARBONE_TIMEOUT'], 60_000, 'CARBONE_TIMEOUT'),
    transport,
    port: parsePositiveInt(process.env['MCP_PORT'], 3000, 'MCP_PORT'),
    mcpPath,
    maxBodyBytes: parsePositiveInt(process.env['MCP_MAX_BODY_BYTES'], 60 * 1024 * 1024, 'MCP_MAX_BODY_BYTES'),
    maxFileBytes: parsePositiveInt(process.env['CARBONE_MAX_FILE_BYTES'], 100 * 1024 * 1024, 'CARBONE_MAX_FILE_BYTES'),
    // HTTP only: when true, a request without an Authorization: Bearer key is rejected instead of
    // falling back to the server-level CARBONE_API_KEY. Defaults to false so a deliberately
    // shared-key deployment keeps working; startHttpServer warns when that combination is live.
    requireClientAuth: parseBool(process.env['CARBONE_REQUIRE_CLIENT_AUTH_HEADER'], false, 'CARBONE_REQUIRE_CLIENT_AUTH_HEADER'),
    // When true, user-supplied URLs may resolve to private/internal addresses. Off by default to
    // block SSRF (cloud metadata, localhost, RFC1918); enable only on a trusted deployment.
    allowPrivateNetwork: parseBool(process.env['CARBONE_ALLOW_PRIVATE_NETWORK'], false, 'CARBONE_ALLOW_PRIVATE_NETWORK'),
  };
}
