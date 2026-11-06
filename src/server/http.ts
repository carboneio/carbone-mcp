import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, localhostAllowedOrigins, McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import type { CarboneClient } from '../carbone/client.js';
import { CarboneAuthError, CarboneError } from '../carbone/errors.js';
import { AuthorizationServerUnavailableError, logOAuth } from '../carbone/tokenExchange.js';
import { isBlockedIp } from '../utils/file.js';
import { registerTools } from '../tools/index.js';
import { registerResources } from '../resources/index.js';
import { serverInfo, serverOptionsFor } from './serverInfo.js';
import type { JobStoreConfig, OAuthConfig, TicketConfig } from './config.js';
import { createOAuthGate } from './oauth.js';
import { uploadSealer as createUploadSealer, UPLOAD_PATH } from './uploadTicket.js';
import { createJobs, JOB_TOKEN_HEADER, JOB_TTL_SECONDS, WEBHOOK_BODY_TIMEOUT_MS, WEBHOOK_MAX_BODY_BYTES, WEBHOOK_PATH } from './jobs.js';
import { createDirStore, createObjectStore } from './objectStore.js';
import { UPLOAD_TICKET_HEADER, UPLOAD_TIMEOUT_MS, createUploadIssuer, createUploadRoute } from './upload.js';

/** Time for an MCP request body to arrive (the Carbone API max timeout + 5 s, as the server's requestTimeout was). */
const MCP_BODY_TIMEOUT_MS = 65_000;

export function parseBody(req: IncomingMessage, maxBytes: number, timeoutMs = MCP_BODY_TIMEOUT_MS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    // The server-wide requestTimeout is longer when upload URLs are on, so an MCP body keeps its own deadline.
    const deadline = setTimeout(() => req.destroy(new Error('Request body timeout')), timeoutMs);
    const onData = (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        // Stop reading at the limit instead of draining the rest: the caller answers 413 with
        // "Connection: close", so the socket is closed once that response is sent.
        clearTimeout(deadline);
        req.off('data', onData);
        req.pause();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => {
      clearTimeout(deadline);
      const raw = Buffer.concat(chunks).toString();
      if (!raw) { resolve(undefined); return; }
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', (err) => {
      clearTimeout(deadline);
      reject(err);
    });
  });
}

/**
 * The client's address. While the address a request came from is one only infrastructure has (an internal proxy:
 * loopback, private, CGNAT… the URL guard's own list), the client is the X-Forwarded-For entry that proxy recorded,
 * one step left. No configuration: it finds the client behind any number of internal proxies, a direct connection
 * never reads the header, and entries a client writes sit left of its real address, out of reach. A port the proxy
 * wrote ("203.0.113.7:51000", "[2001:db8::1]:443") is dropped; an entry that is no IP address ends the walk.
 */
export function clientAddress(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const entries = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '').split(',');
  let address = req.socket.remoteAddress ?? '';
  for (let i = entries.length - 1; i >= 0 && isBlockedIp(address); i--) {
    const entry = entries[i].trim().replace(/^\[([^\]]+)\](?::\d+)?$|^([\d.]+):\d+$/, '$1$2');
    if (!isIP(entry)) break;
    address = entry;
  }
  return address;
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
 * token with the 401 challenge. Every token is introspected and exchanged, and only the exchanged token
 * reaches tool handlers: a Carbone API key is refused, as it was not issued for this server.
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
  /** OpenAI's domain-verification token (MCP_OPENAI_APPS_CHALLENGE), served at /.well-known/openai-apps-challenge. */
  openAiAppsChallenge?: string;
  /** OAuth mode; API-key mode when unset. */
  oauth?: OAuthConfig;
  /** Upload URLs for upload_template (MCP_TICKET_SECRET); off when unset. */
  tickets?: TicketConfig;
  /** With tickets: where async renders keep their results (MCP_S3_* or MCP_JOBS_DIR); async renders off when unset. */
  jobStore?: JobStoreConfig;
}): Promise<Server> {
  const { client, version, port, mcpPath, maxBodyBytes, maxFileBytes, allowPrivateNetwork, allowedOriginHostnames } = options;
  // Built before listening, so a bad issuer stops the server at startup.
  const oauthGate = options.oauth ? createOAuthGate(options.oauth) : undefined;
  // Upload URLs and async renders: tokens sealed with the shared secret, so whichever instance receives the next
  // request (the file, Carbone's webhook call, the assistant asking for the result) can open them.
  const { tickets, jobStore } = options;
  const uploadSealer = tickets && createUploadSealer(tickets.secret, tickets.publicUrl);
  const uploadIssuer = uploadSealer && createUploadIssuer({ sealer: uploadSealer, publicUrl: tickets.publicUrl });
  const handleUpload = uploadSealer && createUploadRoute({ sealer: uploadSealer, client, maxBytes: maxFileBytes, exchange: oauthGate?.exchangeForUpload });
  const store = jobStore && ('dir' in jobStore ? createDirStore(jobStore.dir, { maxAgeMs: JOB_TTL_SECONDS * 1000 }) : createObjectStore(jobStore));
  const jobs = tickets && store && createJobs({ secret: tickets.secret, publicUrl: tickets.publicUrl, store });
  const bodyPaths = [mcpPath, ...(handleUpload ? [UPLOAD_PATH] : []), ...(jobs ? [WEBHOOK_PATH] : [])];
  const serverOptions = serverOptionsFor({ allowLocalPath: false, allowFileOutput: false, allowUploadUrl: !!uploadIssuer, allowAsync: !!jobs });
  /** OAuth mode: how the first MCP requests were addressed is logged, to check the client address on a new platform. */
  let addressSamples = oauthGate ? 3 : 0;

  // ── Health check — answered at once from the last known backend status ───
  // A request starts a background check 30 s after the previous one ended, one at a time, so a slow or
  // unreachable Carbone API never delays /health. Until the first check completes: "checking".
  const HEALTH_REFRESH_MS = 30_000;
  let healthBody: Record<string, unknown> = { mcp: { version }, carbone: { status: 'checking' } };
  let nextHealthCheck = 0;
  let lastHealthStatus: string | undefined;

  const refreshHealthInBackground = (): void => {
    if (Date.now() < nextHealthCheck) return;
    nextHealthCheck = Infinity; // one check at a time
    buildHealthBody(client, version)
      .then((body) => {
        healthBody = body;
        const carbone = body.carbone as Record<string, unknown>;
        const status = carbone.error ? `${carbone.error}: ${carbone.message}` : `ok (v${carbone.version})`;
        if (status !== lastHealthStatus) {
          lastHealthStatus = status;
          process.stderr.write(`[carbone-mcp] backend status changed: ${status}\n`);
        }
      })
      .catch(() => { /* buildHealthBody never rejects — errors are in the response body */ })
      .finally(() => { nextHealthCheck = Date.now() + HEALTH_REFRESH_MS; });
  };

  // ── MCP handler — built once, serves both protocol eras ──────────────────
  // The factory is called for every request: an McpServer serves one exchange at a time.
  // onerror reports out-of-band failures and rejected requests — message only, never bodies or tokens.
  // Messages can echo client-sent values (e.g. a requested protocol version), so sanitize like clientIp.
  const onerror = (err: Error) =>
    process.stderr.write(`[carbone-mcp] MCP error: ${err.message.replace(/[^\x20-\x7E]/g, '')}\n`);
  const mcpHandler = createMcpHandler(() => {
    const mcpServer = new McpServer(serverInfo(version), serverOptions);
    // HTTP clients are remote: they may neither write outputPath to the server's disk nor read
    // local paths from it (that would expose server files such as /proc/self/environ).
    registerTools(mcpServer, client, {
      allowFileOutput: false,
      allowFileInput: false,
      allowPrivateNetwork,
      maxFileBytes,
      ...(uploadIssuer && { uploads: uploadIssuer }),
      ...(jobs && { jobs }),
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

  const handleRequest = async (req: IncomingMessage & { auth?: AuthInfo }, res: ServerResponse) => {
      const start = Date.now();
      let pathname: string;
      try {
        pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      } catch {
        res.writeHead(400).end('Bad Request');
        return;
      }
      // Only the MCP endpoint, uploads and the webhook read a body: elsewhere, close the connection after answering
      // rather than let Node drain one (under requestTimeout, which upload URLs lengthen).
      if (!bodyPaths.includes(pathname) && (req.headers['content-length'] || req.headers['transfer-encoding'])) {
        res.setHeader('Connection', 'close');
      }
      // OAuth mode: the address the failed-token limit applies to, and the one logged. API-key mode logs, as before,
      // the first X-Forwarded-For entry (set by reverse proxies such as nginx, but also by the client) or the socket.
      const address = oauthGate ? clientAddress(req) : undefined;
      // Sanitize to prevent log injection — keep only printable ASCII characters.
      const clientIp = (address ?? (req.headers['x-forwarded-for'] as string | undefined)
        ?.split(',')[0].trim() ?? req.socket.remoteAddress ?? '-')
        .replace(/[^\x20-\x7E]/g, '');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', `Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, ${UPLOAD_TICKET_HEADER}`);
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

        // ── OpenAI domain verification (MCP_OPENAI_APPS_CHALLENGE) ────────────
        if (options.openAiAppsChallenge && (req.method === 'GET' || req.method === 'HEAD')
          && pathname === '/.well-known/openai-apps-challenge') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(req.method === 'HEAD' ? undefined : options.openAiAppsChallenge);
          return;
        }

        // ── Health check ──────────────────────────────────────────────────────
        if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(req.method === 'HEAD' ? undefined : JSON.stringify(healthBody));
          refreshHealthInBackground(); // after the response, so starting a check never adds to it
          return;
        }

        // ── MCP endpoint ──────────────────────────────────────────────────────
        if (pathname === mcpPath) {
          // Origin first, for every method — the guard answers 403 itself when it returns false
          if (!validateOrigin(req, res)) return;

          if (addressSamples > 0) {
            addressSamples--;
            const forwarded = [req.headers['x-forwarded-for'] ?? ''].flat().join(', ').slice(0, 200);
            logOAuth(`request from peer ${req.socket.remoteAddress ?? '-'}, X-Forwarded-For "${forwarded}": limited as ${address}`);
          }

          const token = extractBearerToken(req);
          if (oauthGate) {
            // OAuth mode: verify and exchange the token, or answer the challenge, before reading the body, so a
            // request without a valid token never gets to upload it.
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
            // API-key mode: the Carbone API key is forwarded to the Carbone API as is
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

        // ── Async render webhook (MCP_TICKET_SECRET + a job store) ────────────
        // Carbone's one call per async render, authenticated by the sealed job token it sends back, checked before
        // the body is read; see jobs.ts.
        if (jobs && pathname === WEBHOOK_PATH) {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }
          const token = req.headers[JOB_TOKEN_HEADER];
          const status = await jobs.record(typeof token === 'string' ? token : undefined, () => parseBody(req, WEBHOOK_MAX_BODY_BYTES, WEBHOOK_BODY_TIMEOUT_MS));
          // Refused, the body is left unread: close the connection after answering.
          res.writeHead(status, { 'Content-Type': 'application/json', ...(status !== 200 && { Connection: 'close' }) });
          res.end(JSON.stringify(status === 200 ? { ok: true } : { error: 'Invalid job token' }));
          return;
        }

        // ── Upload URLs (MCP_TICKET_SECRET) ───────────────────────────────────
        // Authenticated by the ticket alone, checked before the body is read; see src/server/upload.ts.
        if (handleUpload && pathname === UPLOAD_PATH) {
          await handleUpload(req, res);
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
            res.end(JSON.stringify({ error: 'Request body too large', maxBytes: pathname === WEBHOOK_PATH ? WEBHOOK_MAX_BODY_BYTES : maxBodyBytes }));
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
  };

  const httpServer = createServer(handleRequest);
  // A client waiting for "100 Continue" (curl does for bodies over 1 MiB) is told to send at once, except on uploads,
  // whose route says so only once the upload URL is checked: a refused upload is then never transferred.
  httpServer.on('checkContinue', (req: IncomingMessage, res: ServerResponse) => {
    if (!handleUpload || !req.url?.startsWith(UPLOAD_PATH)) res.writeContinue();
    void handleRequest(req, res);
  });

  // Abort requests that take longer than the Carbone API max timeout (65 s > 60 s). With upload URLs, a request may
  // be a whole template file arriving: the limit covers the token exchange (10 s) and the upload's own limit. MCP
  // bodies keep 65 s (MCP_BODY_TIMEOUT_MS), and an upload that arrives too slowly is dropped sooner (MIN_UPLOAD_RATE).
  httpServer.requestTimeout = handleUpload ? UPLOAD_TIMEOUT_MS + 15_000 : MCP_BODY_TIMEOUT_MS;

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
    process.stderr.write(`OAuth mode   : resource ${options.oauth.resourceUrl}, authorization server ${options.oauth.issuer}\n`);
  }
  if (tickets) {
    process.stderr.write(`Upload URLs  : ${new URL(UPLOAD_PATH, tickets.publicUrl).href}\n`);
  }
  if (jobs && tickets && jobStore) {
    process.stderr.write(`Async renders: webhook ${new URL(WEBHOOK_PATH, tickets.publicUrl).href}, results in ${'dir' in jobStore ? `directory ${jobStore.dir}` : `bucket ${jobStore.bucket}`}\n`);
    // Reading an object that does not exist must answer "none": otherwise every pending job reads as an error.
    void store!.get('jobs/startup-check').catch((err: unknown) => process.stderr.write(
      `Async renders: the job store cannot be read (${err instanceof Error ? err.message : String(err)}). ` +
      'With S3, the access key needs to read, write and list the bucket (a missing object then answers 404, not 403).\n'
    ));
  }
  return httpServer;
}
