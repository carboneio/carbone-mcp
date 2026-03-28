import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CarboneClient } from '../carbone/client.js';

/** Minimal shape of AuthInfo expected by StreamableHTTPServerTransport on req.auth */
interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
}
import { CarboneAuthError, CarboneError } from '../carbone/errors.js';
import { registerTools } from '../tools/index.js';
import { registerResources } from '../resources/index.js';

export function parseBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      // Keep draining the socket even when over limit so the connection
      // closes cleanly; we check the total on 'end'.
      if (totalBytes <= maxBytes) chunks.push(chunk);
    });
    req.on('end', () => {
      if (totalBytes > maxBytes) {
        reject(new Error('Request body too large'));
        return;
      }
      const raw = Buffer.concat(chunks).toString();
      if (!raw) { resolve(undefined); return; }
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

export function extractBearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  const token = header.slice(7).trim();
  return token || undefined;
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
 * Every incoming MCP request gets its own McpServer + StreamableHTTPServerTransport
 * instance (stateless — no session management). The Bearer token from the
 * Authorization header is forwarded to tool handlers via extra.authInfo.token,
 * which CarboneClient.resolveKey() picks up as the per-call API key.
 *
 * GET  /health   → liveness + backend connectivity probe (no auth required)
 * *    {mcpPath} → MCP Streamable HTTP endpoint (GET/POST/DELETE)
 */
export async function startHttpServer(options: {
  client: CarboneClient;
  version: string;
  port: number;
  mcpPath: string;
  maxBodyBytes: number;
}): Promise<void> {
  const { client, version, port, mcpPath, maxBodyBytes } = options;

  // ── Public static files — loaded once at startup into memory ────────────
  // All files under <cwd>/public/ are served as static assets.
  // Loading at startup (not per-request) prevents path traversal attacks
  // and avoids disk I/O on each request.
  const STATIC_MIME: Record<string, string> = {
    '.json': 'application/json',
    '.txt':  'text/plain',
    '.xml':  'application/xml',
    '.html': 'text/html',
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
      // X-Forwarded-For is set by reverse proxies (Cloudflare, nginx…); fall back to socket address.
      // Sanitize to prevent log injection — keep only printable ASCII characters.
      const clientIp = ((req.headers['x-forwarded-for'] as string | undefined)
        ?.split(',')[0].trim() ?? req.socket.remoteAddress ?? '-')
        .replace(/[^\x20-\x7E]/g, '');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
          // Parse body first — reject oversized/invalid requests before allocating McpServer
          const parsedBody = req.method === 'POST' ? await parseBody(req, maxBodyBytes) : undefined;

          const token = extractBearerToken(req);
          if (token) {
            req.auth = { token, clientId: '', scopes: [] };
          }

          const mcpServer = new McpServer({ name: 'carbone-mcp', version });
          registerTools(mcpServer, client);
          registerResources(mcpServer, client);

          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          });

          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, parsedBody);
          return;
        }

        // ── 404 ───────────────────────────────────────────────────────────────
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      } catch (err) {
        if (!res.headersSent) {
          if (err instanceof Error && err.message === 'Request body too large') {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request body too large', maxBytes: maxBodyBytes }));
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        }
        process.stderr.write(
          `[carbone-mcp] HTTP error: ${err instanceof Error ? err.message : String(err)}\n`
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
      process.exit(0);
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
}
