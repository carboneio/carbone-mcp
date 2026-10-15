import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, localhostAllowedOrigins, McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import type { CarboneClient } from '../carbone/client.js';
import { CarboneAuthError, CarboneError } from '../carbone/errors.js';
import { AuthorizationServerUnavailableError, logOAuth } from '../carbone/tokenExchange.js';
import { registerTools } from '../tools/index.js';
import { registerResources } from '../resources/index.js';
import { serverInfo, SERVER_OPTIONS } from './serverInfo.js';
import type { OAuthConfig } from './config.js';
import { createOAuthGate, isCarboneApiKey } from './oauth.js';

export function parseBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const onData = (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        // Stop reading at the limit instead of draining the rest: the caller answers 413 with
        // "Connection: close", so the socket is closed once that response is sent.
        req.off('data', onData);
        req.pause();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      if (!raw) { resolve(undefined); return; }
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/**
 * The client's address: the TCP peer, or with `trustedHops` reverse proxies in front (MCP_TRUST_PROXY_HOPS), the
 * X-Forwarded-For entry the outermost trusted one recorded. Each proxy appends the address it received from, so
 * that entry is `trustedHops` from the end; anything left of it was written by the client and is never trusted.
 * A port the proxy wrote ("203.0.113.7:51000", "[2001:db8::1]:443") is dropped; an entry that is no IP address
 * gives the peer.
 */
export function clientAddress(req: IncomingMessage, trustedHops: number): string {
  const peer = req.socket.remoteAddress ?? '';
  if (trustedHops === 0) return peer;
  const forwarded = req.headers['x-forwarded-for'];
  const entries = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '').split(',');
  const entry = (entries[entries.length - trustedHops] ?? '').trim().replace(/^\[([^\]]+)\](?::\d+)?$|^([\d.]+):\d+$/, '$1$2');
  return isIP(entry) ? entry : peer;
}

export function extractBearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization?.trim();
  if (!header) return undefined;
  // RFC 6750: the scheme and the token are separated by spaces, as the OAuth gate reads them too.
  const [scheme, ...rest] = header.split(/ +/);
  const isBearer = scheme.toLowerCase() === 'bearer';
  // "Bearer <key>", or a bare key without a scheme. Another scheme (Basic, Digest…), a Bearer without a token, and
  // a value with other whitespace ("Bearer<TAB>key") carry no Carbone key: they are never forwarded to the Carbone API.
  if (rest.length === 0) return isBearer || /\s/.test(scheme) ? undefined : scheme;
  return isBearer ? rest.join(' ') : undefined;
}

/**
 * Build the /health response body.
 * Always HTTP 200 — the status code signals MCP server liveness.
 *
 * The `carbone` field shows backend connectivity:
 *   { version }                        — reachable and authenticated
 *   { error: "unauthorized", message } — reachable but no/invalid API key
 *   { error: "unreachable",  message } — network error, timeout, or unexpected response
 */
async function buildHealthBody(
  client: CarboneClient,
  version: string
): Promise<Record<string, unknown>> {
  let carboneInfo: Record<string, unknown>;
  try {
    const status = await client.getStatus();
    carboneInfo = { version: status.version };
  } catch (err) {
    if (err instanceof CarboneAuthError) {
      carboneInfo = { error: 'unauthorized', message: err.message };
    } else if (err instanceof CarboneError) {
      carboneInfo = { error: 'unreachable', message: err.message };
    } else {
      carboneInfo = {
        error: 'unreachable',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    mcp:    { version },
    carbone: carboneInfo,
  };
}

/**
 * Start the Carbone MCP server in Streamable HTTP mode.
 *
 * One SDK handler serves both protocol eras: 2026-07-28 requests and, statelessly,
 * 2025-era (initialize) clients. Every incoming MCP request gets its own McpServer
 * from the factory (no session management). The Bearer token from the
 * Authorization header is forwarded to tool handlers via ctx.http.authInfo.token,
 * which CarboneClient.resolveKey() picks up as the per-call API key.
 *
 * GET  /health   → liveness + backend connectivity probe (no auth required)
 * POST {mcpPath} → MCP Streamable HTTP endpoint (stateless: GET/DELETE are answered 405)
 *
 * OAuth mode (`oauth` set, Carbone's hosted server) adds the RFC 9728 metadata at
 * /.well-known/oauth-protected-resource[/<path>], and answers an MCP request without a valid
 * token with the 401 challenge. A Bearer shaped like a Carbone API key is still forwarded as is;
 * any other one is introspected and exchanged, and only the exchanged token reaches tool handlers.
 *
 * Resolves with the listening server (tests listen on port 0 and close it).
 */
export async function startHttpServer(options: {
  client: CarboneClient;
  version: string;
  port: number;
  mcpPath: string;
  maxBodyBytes: number;
  maxFileBytes: number;
  allowPrivateNetwork: boolean;
  /** Browser Origin hostnames allowed in addition to localhost (MCP_ALLOWED_ORIGINS). */
  allowedOriginHostnames: string[];
  /** OAuth mode; API-key mode when unset. */
  oauth?: OAuthConfig;
}): Promise<Server> {
  const { client, version, port, mcpPath, maxBodyBytes, maxFileBytes, allowPrivateNetwork, allowedOriginHostnames } = options;
  // Built before listening, so a bad issuer stops the server at startup.
  const oauthGate = options.oauth ? createOAuthGate(options.oauth) : undefined;
  const trustProxyHops = options.oauth?.trustProxyHops ?? 0;
  /** OAuth mode: how the first MCP requests were addressed is logged, to check MCP_TRUST_PROXY_HOPS on a deployment. */
  let addressSamples = oauthGate ? 3 : 0;

  // ── Public static files — loaded once at startup into memory ────────────
  // All files under <cwd>/public/ are served as static assets.
  // Loading at startup (not per-request) prevents path traversal attacks
  // and avoids disk I/O on each request.
  const STATIC_MIME: Record<string, string> = {
    '.json': 'application/json',
    '.txt':  'text/plain',
    '.xml':  'application/xml',
    '.html': 'text/html',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
  };
  const staticFiles = new Map<string, { content: Buffer; mime: string }>();
  try {
    const publicDir = resolve(process.cwd(), 'public');
    const entries = await readdir(publicDir, { recursive: true });
    await Promise.all(
      entries.map(async (entry) => {
        const filePath = join(publicDir, entry);
        const content = await readFile(filePath);
        const mime = STATIC_MIME[extname(entry)] ?? 'application/octet-stream';
        // Normalize path separators to forward slashes (Windows compat)
        staticFiles.set('/' + entry.toString().replace(/\\/g, '/'), { content, mime });
      })
    );
  } catch { /* public directory is optional */ }

  // ── Health check cache — refreshed at most once every 30 s ───────────────
  // Storing the promise (not the result) prevents concurrent requests from
  // each triggering a backend call while the first one is still in-flight.
  const HEALTH_CACHE_TTL_MS = 30_000;
  let healthCachePromise: Promise<Record<string, unknown>> | undefined;
  let lastHealthStatus: string | undefined;

  // ── MCP handler — built once, serves both protocol eras ──────────────────
  // The factory is called for every request: an McpServer serves one exchange at a time.
  // onerror reports out-of-band failures and rejected requests — message only, never bodies or tokens.
  // Messages can echo client-sent values (e.g. a requested protocol version), so sanitize like clientIp.
  const onerror = (err: Error) =>
    process.stderr.write(`[carbone-mcp] MCP error: ${err.message.replace(/[^\x20-\x7E]/g, '')}\n`);
  const mcpHandler = createMcpHandler(() => {
    const mcpServer = new McpServer(serverInfo(version), SERVER_OPTIONS);
    // HTTP clients are remote: they may neither write outputPath to the server's disk nor read
    // local paths from it (that would expose server files such as /proc/self/environ).
    registerTools(mcpServer, client, {
      allowFileOutput: false,
      allowFileInput: false,
      allowPrivateNetwork,
      maxFileBytes,
    });
    registerResources(mcpServer, client);
    return mcpServer;
  }, { onerror });
  // POST bodies are pre-parsed below (bounded by maxBodyBytes), which bypasses the SDK's own 4 MiB
  // limit; the adapter applies the same bound to any other request body it reads itself.
  const handleMcpRequest = toNodeHandler(mcpHandler, { maxRequestBodySize: maxBodyBytes, onerror });
  // DNS-rebinding protection: a request carrying an Origin header must come from localhost or a
  // listed hostname, otherwise it is answered 403. Non-browser clients send no Origin and pass.
  const validateOrigin = originValidation([...localhostAllowedOrigins(), ...allowedOriginHostnames]);

  const httpServer = createServer(
    async (req: IncomingMessage & { auth?: AuthInfo }, res: ServerResponse) => {
      const start = Date.now();
      let pathname: string;
      try {
        pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      } catch {
        res.writeHead(400).end('Bad Request');
        return;
      }
      // OAuth mode: the address the failed-token limit applies to, from the TCP peer or a trusted proxy.
      const address = clientAddress(req, trustProxyHops);
      // Logged: that address when proxies are trusted; otherwise the first X-Forwarded-For entry (set by reverse
      // proxies such as Cloudflare or nginx, but also by the client itself) or the socket address.
      // Sanitize to prevent log injection — keep only printable ASCII characters.
      const clientIp = (trustProxyHops ? address : (req.headers['x-forwarded-for'] as string | undefined)
        ?.split(',')[0].trim() ?? req.socket.remoteAddress ?? '-')
        .replace(/[^\x20-\x7E]/g, '');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Method, Mcp-Name');
      // Browser clients must be able to read the OAuth challenge, and how long to wait after a 429 or 503.
      res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id, Retry-After');
      res.on('finish', () => {
        process.stderr.write(
          `[carbone-mcp] ${req.method} ${pathname} ${res.statusCode} ${Date.now() - start}ms ${clientIp}\n`
        );
      });
      try {

        // ── CORS preflight ────────────────────────────────────────────────────
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        // ── OAuth Protected Resource Metadata (RFC 9728), OAuth mode only ─────
        // Public and outside Origin validation; any Origin may read it (Access-Control-Allow-Origin: *).
        if (oauthGate?.metadataPaths.has(pathname)) {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, HEAD, OPTIONS' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(req.method === 'HEAD' ? undefined : oauthGate.metadataJson);
          return;
        }

        // ── Public static files ───────────────────────────────────────────────
        if ((req.method === 'GET' || req.method === 'HEAD') && staticFiles.has(pathname)) {
          const file = staticFiles.get(pathname)!;
          res.writeHead(200, { 'Content-Type': file.mime });
          res.end(req.method === 'HEAD' ? undefined : file.content);
          return;
        }

        // ── Health check ──────────────────────────────────────────────────────
        if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/health') {
          if (!healthCachePromise) {
            healthCachePromise = buildHealthBody(client, version);
            healthCachePromise.then(body => {
              const carbone = body.carbone as Record<string, unknown>;
              const status = carbone.error
                ? `${carbone.error}: ${carbone.message}`
                : `ok (v${carbone.version})`;
              if (status !== lastHealthStatus) {
                lastHealthStatus = status;
                process.stderr.write(`[carbone-mcp] backend status changed: ${status}\n`);
              }
            }).catch(() => { /* buildHealthBody never rejects — errors are in the response body */ });
            setTimeout(() => { healthCachePromise = undefined; }, HEALTH_CACHE_TTL_MS).unref();
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(req.method === 'HEAD' ? undefined : JSON.stringify(await healthCachePromise));
          return;
        }

        // ── MCP endpoint ──────────────────────────────────────────────────────
        if (pathname === mcpPath) {
          // Origin first, for every method — the guard answers 403 itself when it returns false
          if (!validateOrigin(req, res)) return;

          if (addressSamples > 0) {
            addressSamples--;
            const forwarded = [req.headers['x-forwarded-for'] ?? ''].flat().join(', ').slice(0, 200);
            logOAuth(`request from peer ${req.socket.remoteAddress ?? '-'}, X-Forwarded-For "${forwarded}", ` +
              `MCP_TRUST_PROXY_HOPS ${trustProxyHops}: limited as ${address}`);
          }

          const token = extractBearerToken(req);
          if (oauthGate && !(token && isCarboneApiKey(token))) {
            // OAuth mode, and no Carbone API key: verify and exchange the token, or answer the challenge, before
            // reading the body, so a request without a valid token never gets to upload it.
            // Stop waiting for the exchange if the client goes away.
            const gone = new AbortController();
            res.once('close', () => gone.abort());
            const auth = await oauthGate.authenticate(req.headers.authorization, gone.signal, address);
            if (auth instanceof Response) {
              // The body is unread: when it has not all arrived, close the connection rather than let Node drain it.
              res.writeHead(auth.status, { ...Object.fromEntries(auth.headers), ...(!req.complete && { Connection: 'close' }) });
              res.end(await auth.text());
              return;
            }
            req.auth = auth;
          } else if (token) {
            // A Carbone API key (API-key mode, or an API key in OAuth mode): forwarded to the Carbone API as is
            req.auth = { token, clientId: '', scopes: [] };
          }

          // Reject oversized/invalid bodies before allocating McpServer
          const parsedBody = req.method === 'POST' ? await parseBody(req, maxBodyBytes) : undefined;
          // An empty POST body is malformed too, and must not reach the handler: given no body it
          // would try to read the already-consumed request stream again.
          if (req.method === 'POST' && parsedBody === undefined) throw new Error('Invalid JSON body');

          await handleMcpRequest(req, res, parsedBody);
          return;
        }

        // ── 404 ───────────────────────────────────────────────────────────────
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      } catch (err) {
        if (!res.headersSent) {
          if (err instanceof Error && err.message === 'Request body too large') {
            // The unread rest of the body is still in flight: close the connection after answering.
            res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
            res.end(JSON.stringify({ error: 'Request body too large', maxBytes: maxBodyBytes }));
          } else if (err instanceof AuthorizationServerUnavailableError) {
            // OAuth mode: the token could not be checked or exchanged. 503, never 401, which would send the
            // client to sign in again for nothing.
            // The body may still be on its way (OAuth runs first): then close the connection after answering.
            res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': String(err.retryAfterSeconds), ...(!req.complete && { Connection: 'close' }) });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Service unavailable: the authorization server could not be reached. Retry later.', data: { error: 'server_error' } },
              id: null,
            }));
          } else if (err instanceof Error && err.message === 'Invalid JSON body') {
            // JSON-RPC parse error, as the SDK itself answers a malformed body
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: Invalid JSON' }, id: null }));
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        }
        // Sanitized like the access log: printable ASCII only, so a message can't forge log lines.
        process.stderr.write(
          `[carbone-mcp] HTTP error: ${(err instanceof Error ? err.message : String(err)).replace(/[^\x20-\x7E]/g, '')}\n`
        );
      }
    }
  );

  // Abort requests that take longer than the Carbone API max timeout (65 s > 60 s)
  httpServer.requestTimeout = 65_000;

  // Graceful shutdown — stop accepting connections, wait for in-flight requests.
  // Force-exit after 10 s to avoid hanging indefinitely on stuck keep-alive connections.
  const shutdown = (signal: string) => {
    process.stderr.write(`[carbone-mcp] ${signal} received — shutting down gracefully\n`);
    // Drop idle keep-alive connections immediately so the process doesn't wait for them to time out
    httpServer.closeIdleConnections();
    httpServer.close(() => {
      process.stderr.write('[carbone-mcp] All connections closed — exiting\n');
      // Closed only now so in-flight requests are not aborted; releases any server instance it still holds.
      void mcpHandler.close().finally(() => process.exit(0));
    });
    setTimeout(() => {
      process.stderr.write('[carbone-mcp] Graceful shutdown timed out — forcing exit\n');
      process.exit(1);
    }, 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT',  () => shutdown('SIGINT'));

  await new Promise<void>((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(port, resolve);
  });

  process.stderr.write(`Carbone MCP Server v${version} running in HTTP mode\n`);
  process.stderr.write(`MCP endpoint : http://0.0.0.0:${port}${mcpPath}\n`);
  process.stderr.write(`Health check : http://0.0.0.0:${port}/health\n`);
  if (options.oauth) {
    process.stderr.write(`OAuth mode   : resource ${options.oauth.resourceUrl}, authorization server ${options.oauth.issuer}, trusted proxies ${trustProxyHops}\n`);
  }
  return httpServer;
}
