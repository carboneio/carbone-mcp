import { CarboneClient } from '../carbone/client.js';
import { UPLOAD_PATH } from './uploadTicket.js';
import { parseTicketSecret } from './sealer.js';
import { WEBHOOK_PATH } from './jobs.js';
import { accessSync, constants, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { ObjectStoreConfig } from './objectStore.js';
import { DISABLEABLE_TOOLS, type ToolName } from '../tools/toolNames.js';

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
  /** MCP_DISABLED_TOOLS: tools (and their resources) not registered, nor named in the instructions or the other listings. */
  disabledTools: ReadonlySet<ToolName>;
  /** HTTP only: OpenAI's domain-verification token, served at /.well-known/openai-apps-challenge (MCP_OPENAI_APPS_CHALLENGE). */
  openAiAppsChallenge?: string;
  /** HTTP OAuth mode (Carbone's hosted server), when every MCP_OAUTH_* variable is set; API-key mode otherwise. */
  oauth?: OAuthConfig;
  /** HTTP only, when MCP_TICKET_SECRET is set: upload_template issues upload URLs. */
  tickets?: TicketConfig;
  /** HTTP only, with tickets, when MCP_S3_* or MCP_JOBS_DIR is set: render_document runs async renders itself. */
  jobStore?: JobStoreConfig;
}

/** Where async render results are kept: an S3-compatible bucket (MCP_S3_*), or a directory (MCP_JOBS_DIR). */
export type JobStoreConfig = ObjectStoreConfig | { dir: string };

export interface TicketConfig {
  /** MCP_TICKET_SECRET: seals and opens upload tickets and async render jobs. */
  secret: Buffer;
  /** The origin upload URLs point to (MCP_PUBLIC_URL, by default the origin of MCP_RESOURCE_URL). */
  publicUrl: string;
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

/** A secure URL written as a bare origin: no path, not even a trailing slash. */
function isSecureOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return isSecureUrl(url) && value === url.origin;
  } catch {
    return false;
  }
}

/** An environment variable, trimmed; undefined when unset or blank. */
const setting = (name: string) => process.env[name]?.trim() || undefined;

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
  // An origin, written as the authorization server writes its own issuer: the endpoints are built from it, and
  // clients refuse metadata whose issuer differs from the one advertised by even a trailing slash (RFC 8414 §3.3).
  if (!isSecureOrigin(issuer)) {
    throw new Error(`Invalid MCP_OAUTH_ISSUER value "${issuer}". Must be an https origin without a path or trailing slash, such as "${DEFAULT_OAUTH_ISSUER}".`);
  }
  return {
    issuer,
    clientId: env('MCP_OAUTH_CLIENT_ID')!,
    clientSecret: env('MCP_OAUTH_CLIENT_SECRET')!,
    resourceUrl: parseResourceUrl(env('MCP_RESOURCE_URL')!, mcpPath),
  };
}

/**
 * Upload URLs (and async renders, with an object store) are on when MCP_TICKET_SECRET is set. Every instance behind a
 * load balancer must share the secret, as a ticket issued by one is opened by whichever receives the next request.
 * They need the public origin to build their URLs.
 */
function loadTicketConfig(transport: TransportMode, mcpPath: string, oauth: OAuthConfig | undefined): TicketConfig | undefined {
  const secret = setting('MCP_TICKET_SECRET');
  if (!secret) return undefined;
  if (transport !== 'http') {
    throw new Error('MCP_TICKET_SECRET is for the HTTP transport: set MCP_TRANSPORT=http, or unset MCP_TICKET_SECRET.');
  }
  if (mcpPath === UPLOAD_PATH || mcpPath === WEBHOOK_PATH) {
    throw new Error(`MCP_PATH "${mcpPath}" is reserved for upload URLs and async renders: choose another MCP_PATH, or unset MCP_TICKET_SECRET.`);
  }
  const publicUrl = setting('MCP_PUBLIC_URL') ?? (oauth && new URL(oauth.resourceUrl).origin);
  if (!publicUrl) {
    throw new Error('MCP_TICKET_SECRET needs the public address of this server: set MCP_PUBLIC_URL (e.g. "https://mcp.example.com").');
  }
  if (!isSecureOrigin(publicUrl)) {
    throw new Error(`Invalid MCP_PUBLIC_URL value "${publicUrl}". Must be an https origin without a path or trailing slash, such as "https://mcp.example.com".`);
  }
  return { secret: parseTicketSecret(secret), publicUrl };
}

/**
 * Where async renders keep their results, shared by every instance: a directory (MCP_JOBS_DIR), or an S3-compatible
 * bucket (all five MCP_S3_* variables, or none); async renders are off without either. Needs MCP_TICKET_SECRET,
 * which seals what is stored.
 */
function loadJobStoreConfig(tickets: TicketConfig | undefined): JobStoreConfig | undefined {
  const names = ['MCP_S3_ENDPOINT', 'MCP_S3_REGION', 'MCP_S3_BUCKET', 'MCP_S3_ACCESS_KEY_ID', 'MCP_S3_SECRET_ACCESS_KEY'] as const;
  const values = names.map(setting);
  const dir = setting('MCP_JOBS_DIR');
  if (dir && values.some((v) => v !== undefined)) {
    throw new Error('Async renders keep their results in MCP_JOBS_DIR or in MCP_S3_*, not both: unset one.');
  }
  if (dir) {
    if (!tickets) throw new Error('Async renders (MCP_JOBS_DIR) need MCP_TICKET_SECRET: set it too.');
    let writable = false;
    try {
      accessSync(dir, constants.W_OK);
      writable = statSync(dir).isDirectory();
    } catch { /* reported below */ }
    if (!isAbsolute(dir) || !writable) {
      throw new Error(`Invalid MCP_JOBS_DIR value "${dir}". Must be the absolute path of an existing, writable directory.`);
    }
    return { dir };
  }
  if (values.every((v) => v === undefined)) return undefined;
  const missing = names.filter((_, i) => values[i] === undefined);
  if (missing.length) {
    throw new Error(`Async renders are partially configured: set ${missing.join(', ')}, or unset every MCP_S3_* variable.`);
  }
  if (!tickets) throw new Error('Async renders (MCP_S3_*) need MCP_TICKET_SECRET: set it too.');
  const [endpoint, region, bucket, accessKeyId, secretAccessKey] = values as string[];
  if (!isSecureOrigin(endpoint!)) {
    throw new Error(`Invalid MCP_S3_ENDPOINT value "${endpoint}". Must be an https origin, such as "https://s3.example.com" (http on localhost).`);
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket!)) {
    throw new Error(`Invalid MCP_S3_BUCKET value "${bucket}". Must be a bucket name: lowercase letters, digits, dots and hyphens.`);
  }
  return { endpoint: endpoint!, region: region!, bucket: bucket!, accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! };
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

/**
 * Comma-separated tool names, for a self-hosted Carbone that lacks some features, or a read-only agent. An unknown
 * name, or get_capabilities, stops the server: a typo must never leave a tool enabled. The message stays under the 300 characters a log
 * value keeps, so that it always shows the valid names; the entry is quoted as JSON, with any invisible character escaped.
 */
function parseDisabledTools(value: string | undefined, name: string): ReadonlySet<ToolName> {
  const entries = new Set((value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean));
  const unknown = [...entries].find((entry) => !(DISABLEABLE_TOOLS as readonly string[]).includes(entry));
  if (unknown !== undefined) {
    const quoted = JSON.stringify(unknown).replace(/[^\x20-\x7E]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    throw new Error(`${name}: cannot disable ${quoted.length > 28 ? `${quoted.slice(0, 24)}..."` : quoted} (valid: ${DISABLEABLE_TOOLS.join(', ')})`);
  }
  return entries as Set<ToolName>;
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
  const tickets = loadTicketConfig(transport, mcpPath, oauth);
  const jobStore = loadJobStoreConfig(tickets);

  const openAiAppsChallenge = process.env['MCP_OPENAI_APPS_CHALLENGE']?.trim() || undefined;
  if (openAiAppsChallenge && /\s/.test(openAiAppsChallenge)) {
    throw new Error('Invalid MCP_OPENAI_APPS_CHALLENGE value. Paste the token exactly as OpenAI shows it, without spaces.');
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
    // shared-key deployment keeps working; HTTP startup (src/index.ts) warns when that combination is live.
    // Always true in OAuth mode, where an unauthenticated request gets the 401 challenge.
    requireClientAuth: parseBool(process.env['CARBONE_REQUIRE_CLIENT_AUTH_HEADER'], false, 'CARBONE_REQUIRE_CLIENT_AUTH_HEADER') || !!oauth,
    // When true, user-supplied URLs may resolve to private/internal addresses. Off by default to
    // block SSRF (cloud metadata, localhost, RFC1918); enable only on a trusted deployment.
    allowPrivateNetwork: parseBool(process.env['CARBONE_ALLOW_PRIVATE_NETWORK'], false, 'CARBONE_ALLOW_PRIVATE_NETWORK'),
    // HTTP only: browser Origins allowed in addition to localhost (DNS-rebinding protection).
    allowedOriginHostnames: parseOriginHostnames(process.env['MCP_ALLOWED_ORIGINS'], 'MCP_ALLOWED_ORIGINS'),
    disabledTools: parseDisabledTools(process.env['MCP_DISABLED_TOOLS'], 'MCP_DISABLED_TOOLS'),
    ...(openAiAppsChallenge && { openAiAppsChallenge }),
    ...(oauth && { oauth }),
    ...(tickets && { tickets }),
    ...(jobStore && { jobStore }),
  };
}
