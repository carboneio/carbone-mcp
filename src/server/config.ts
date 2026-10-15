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
  allowedOriginHostnames: string[];
  /** HTTP OAuth mode (Carbone's hosted server), when every MCP_OAUTH_* variable is set; API-key mode otherwise. */
  oauth?: OAuthConfig;
}

export interface OAuthConfig {
  /** Authorization server issuer (MCP_OAUTH_ISSUER). */
  issuer: string;
  /** This server's own confidential-client credentials at the authorization server. */
  clientId: string;
  clientSecret: string;
  /** The URL MCP clients connect to, exactly as they enter it (MCP_RESOURCE_URL): the RFC 8707 resource. */
  resourceUrl: string;
}

export const DEFAULT_OAUTH_ISSUER = 'https://account.carbone.io';

/** https, or http on a loopback host (local testing): the rule the SDK applies to an issuer. */
function isSecureUrl(url: URL): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
}

/**
 * MCP_RESOURCE_URL must be the canonical URL clients connect to, because the PRM `resource` and the token
 * audience are compared with it as strings. An origin-only URL is written without a trailing slash
 * ("https://mcp.carbone.io", which URL.href would turn into ".../"); a URL with a path is written as URL.href
 * normalizes it. Either way its path ("/" for an origin) must be MCP_PATH, the path the server answers on.
 */
function parseResourceUrl(value: string, mcpPath: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid MCP_RESOURCE_URL value "${value}". Must be an absolute URL such as "https://mcp.carbone.io".`);
  }
  if (!isSecureUrl(url) || value.includes('?') || value.includes('#') || url.username || url.password) {
    throw new Error(`Invalid MCP_RESOURCE_URL value "${value}". Must be an https URL without query, fragment or credentials.`);
  }
  const canonical = url.pathname === '/' ? url.origin : url.href;
  if (value !== canonical) {
    throw new Error(`Invalid MCP_RESOURCE_URL value "${value}". Write it in canonical form: "${canonical}".`);
  }
  if (url.pathname !== mcpPath) {
    throw new Error(
      `MCP_RESOURCE_URL path "${url.pathname}" must equal MCP_PATH "${mcpPath}": the resource is the URL clients connect to.`
    );
  }
  return value;
}

/**
 * OAuth mode is on when the MCP_OAUTH_* variables are set (MCP_OAUTH_ISSUER has a default). Setting only some of
 * them is an error, never a silent fallback to API-key mode. In OAuth mode no server key may exist: every request
 * authenticates with its own token.
 */
function loadOAuthConfig(transport: TransportMode, mcpPath: string, apiKey: string | undefined): OAuthConfig | undefined {
  const env = (name: string) => process.env[name] || undefined;
  const required = ['MCP_OAUTH_CLIENT_ID', 'MCP_OAUTH_CLIENT_SECRET', 'MCP_RESOURCE_URL'];
  if (![...required, 'MCP_OAUTH_ISSUER'].some(env)) return undefined;

  const missing = required.filter((name) => !env(name));
  if (missing.length) {
    throw new Error(
      `OAuth mode is partially configured: set ${missing.join(', ')}, ` +
      'or unset every MCP_OAUTH_* and MCP_RESOURCE_URL variable to run in API-key mode.'
    );
  }
  if (transport !== 'http') {
    throw new Error('OAuth mode (MCP_OAUTH_* variables) is for the HTTP transport: set MCP_TRANSPORT=http.');
  }
  if (apiKey) {
    throw new Error(
      'CARBONE_API_KEY must not be set in OAuth mode: each request authenticates with its own token, and no server key is ever used.'
    );
  }
  const issuer = env('MCP_OAUTH_ISSUER') ?? DEFAULT_OAUTH_ISSUER;
  let issuerUrl: URL | undefined;
  try { issuerUrl = new URL(issuer); } catch { /* reported below */ }
  // An origin, written as the authorization server writes its own issuer: the endpoints are built from it, and
  // clients refuse metadata whose issuer differs from the one advertised by even a trailing slash (RFC 8414 §3.3).
  if (!issuerUrl || !isSecureUrl(issuerUrl) || issuer !== issuerUrl.origin) {
    throw new Error(`Invalid MCP_OAUTH_ISSUER value "${issuer}". Must be an https origin without a path or trailing slash, such as "${DEFAULT_OAUTH_ISSUER}".`);
  }
  return {
    issuer,
    clientId: env('MCP_OAUTH_CLIENT_ID')!,
    clientSecret: env('MCP_OAUTH_CLIENT_SECRET')!,
    resourceUrl: parseResourceUrl(env('MCP_RESOURCE_URL')!, mcpPath),
  };
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

/**
 * Comma-separated Origin hostnames. Each entry must be exactly what a browser Origin's hostname
 * can be (it survives URL normalization unchanged), or `<scheme>://*` for a browser-extension
 * scheme. Anything else (a full origin, a port, a wildcard) could never match, and would silently
 * reject every browser client, so it is refused at startup.
 */
function parseOriginHostnames(value: string | undefined, name: string): string[] {
  const entries = (value ?? '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  for (const entry of entries) {
    const extensionScheme = /^([a-z][a-z0-9+.-]*):\/\/\*$/.exec(entry)?.[1];
    if (extensionScheme ? extensionScheme !== 'http' && extensionScheme !== 'https' : isOriginHostname(entry)) continue;
    throw new Error(
      `Invalid ${name} entry "${entry}". Must be a hostname without scheme, port, path or wildcard ` +
      '(e.g. "app.example.com"), or "<scheme>://*" for browser extensions (e.g. "moz-extension://*").'
    );
  }
  return entries;
}

function isOriginHostname(entry: string): boolean {
  if (entry.includes('*')) return false;
  try {
    return new URL(`http://${entry}`).hostname === entry;
  } catch {
    return false;
  }
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

  const oauth = loadOAuthConfig(transport, mcpPath, apiKey);

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
    // shared-key deployment keeps working; HTTP startup (src/index.ts) warns when that combination is live.
    // Always true in OAuth mode, where an unauthenticated request gets the 401 challenge.
    requireClientAuth: parseBool(process.env['CARBONE_REQUIRE_CLIENT_AUTH_HEADER'], false, 'CARBONE_REQUIRE_CLIENT_AUTH_HEADER') || !!oauth,
    // When true, user-supplied URLs may resolve to private/internal addresses. Off by default to
    // block SSRF (cloud metadata, localhost, RFC1918); enable only on a trusted deployment.
    allowPrivateNetwork: parseBool(process.env['CARBONE_ALLOW_PRIVATE_NETWORK'], false, 'CARBONE_ALLOW_PRIVATE_NETWORK'),
    // HTTP only: browser Origins allowed in addition to localhost (DNS-rebinding protection).
    allowedOriginHostnames: parseOriginHostnames(process.env['MCP_ALLOWED_ORIGINS'], 'MCP_ALLOWED_ORIGINS'),
    ...(oauth && { oauth }),
  };
}
