import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { Client, StreamableHTTPClientTransport, type VersionNegotiationMode } from '@modelcontextprotocol/client';
import { CarboneClient } from '../../src/carbone/client.js';
import { startHttpServer } from '../../src/server/http.js';
import { ACCESS_TOKEN_TYPE, TOKEN_EXCHANGE_GRANT_TYPE } from '../../src/carbone/tokenExchange.js';
import type { OAuthConfig } from '../../src/server/config.js';

/**
 * OAuth resource-server mode end to end, on real local HTTP servers (port 0), never the network:
 * - a mock authorization server implementing the contract this server relies on (RFC 7662 introspection and
 *   RFC 8693 token exchange, client_secret_basic, form bodies, RFC error codes);
 * - a mock Carbone API recording the Authorization header of every call;
 * - the MCP server in OAuth mode, driven by a generic SDK client (plain User-Agent, a DCR client_id), in the
 *   legacy era and pinned to 2026-07-28; then in API-key mode, which must behave exactly as before.
 */

const MODERN = '2026-07-28';
const RESOURCE = 'https://mcp.example.test';
const CLIENT_ID = 'mcp-server';
const CLIENT_SECRET = 'srv-secret:with+special/chars=';
const SERVER_KEY = `server-key-${randomBytes(6).toString('hex')}`;
const USER_AGENT = 'generic-mcp-client/1.0';
const MAX_BODY_BYTES = 1024 * 1024;

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload: Record<string, unknown>) =>
  `${b64url({ alg: 'ES512', typ: 'JWT' })}.${b64url(payload)}.${randomBytes(132).toString('base64url')}`;
/** Shaped like a real Carbone API key (aud "carbone", numeric-string iss). */
const apiKey = () => jwt({ iss: String(Date.now()), aud: 'carbone', exp: Math.floor(Date.now() / 1000) + 3600, data: { type: 'test' } });
const opaque = () => randomBytes(24).toString('base64url');

// ── stderr: captured to prove no token, secret or Authorization header is ever logged ──
let log = '';
const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
  log += String(chunk);
  return true;
});
const secretsSeen = new Set<string>([CLIENT_SECRET, SERVER_KEY]);

// ── Mock authorization server ─────────────────────────────────────────────────

interface Grant { sub: string; scope: string; aud: string; exp: number; testAccount?: boolean }
const grants = new Map<string, Grant>();
const as = {
  introspected: [] as string[],
  exchanged: [] as string[],
  /** Access tokens issued by the exchange, per subject token. */
  issued: new Map<string, string[]>(),
  /** Introspection answers 503 for these tokens; the exchange revokes those, then answers invalid_request. */
  failIntrospection: new Set<string>(),
  rejectExchange: new Set<string>(),
};
let asServer: Server;
let asUrl: string;

/** A user's opaque token, bound to `aud`, as the authorization server would issue it to an MCP client. */
function grant(overrides: Partial<Grant> = {}): string {
  const token = opaque();
  grants.set(token, { sub: '42', scope: 'doc_rwd', aud: RESOURCE, exp: Math.floor(Date.now() / 1000) + 3600, ...overrides });
  secretsSeen.add(token);
  return token;
}

const formDecode = (value: string) => decodeURIComponent(value.replace(/\+/g, ' '));
/** client_secret_basic, decoded as RFC 6749 §2.3.1 says (form-encoded id and secret). */
function authenticatedClient(req: IncomingMessage): boolean {
  const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (!basic) return false;
  const decoded = Buffer.from(basic, 'base64').toString();
  const colon = decoded.indexOf(':');
  return formDecode(decoded.slice(0, colon)) === CLIENT_ID && formDecode(decoded.slice(colon + 1)) === CLIENT_SECRET;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(body));
}

async function authorizationServer(req: IncomingMessage, res: ServerResponse) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const form = new URLSearchParams(raw);
  if (req.method !== 'POST' || req.headers['content-type'] !== 'application/x-www-form-urlencoded') {
    return send(res, 400, { error: 'invalid_request' });
  }
  if (!authenticatedClient(req)) return send(res, 401, { error: 'invalid_client' });

  if (req.url === '/api/oauth/introspect') {
    const token = form.get('token') ?? '';
    as.introspected.push(token);
    if (as.failIntrospection.has(token)) return send(res, 503, { error: 'temporarily_unavailable' }, { 'Retry-After': '7' });
    const g = grants.get(token);
    // Active only for a live token bound to this client's registered resource: {active:false} otherwise.
    if (!g || g.aud !== RESOURCE || g.exp <= Date.now() / 1000) return send(res, 200, { active: false });
    return send(res, 200, { active: true, scope: g.scope, client_id: 'example-client', sub: g.sub, exp: g.exp, aud: g.aud, token_type: 'Bearer' });
  }

  if (req.url === '/api/oauth/token') {
    if (form.get('grant_type') !== TOKEN_EXCHANGE_GRANT_TYPE) return send(res, 400, { error: 'unsupported_grant_type' });
    if (form.get('subject_token_type') !== ACCESS_TOKEN_TYPE || form.has('actor_token')) return send(res, 400, { error: 'invalid_request' });
    const subject = form.get('subject_token') ?? '';
    as.exchanged.push(subject);
    const g = grants.get(subject);
    // A revocation between the introspection and the exchange: the next introspection finds the token inactive
    if (as.rejectExchange.has(subject)) grants.delete(subject);
    if (!g || g.aud !== RESOURCE || as.rejectExchange.has(subject)) {
      return send(res, 400, { error: 'invalid_request', error_description: 'refused' });
    }
    if (!g.scope.split(' ').includes('doc_rwd')) return send(res, 400, { error: 'invalid_request', error_description: 'refused' });
    const accessToken = `${g.testAccount ? 'test_' : ''}${jwt({ iss: g.sub, aud: 'carbone', jti: randomBytes(8).toString('hex') })}`;
    as.issued.set(subject, [...(as.issued.get(subject) ?? []), accessToken]);
    secretsSeen.add(accessToken);
    return send(res, 200, { access_token: accessToken, issued_token_type: ACCESS_TOKEN_TYPE, token_type: 'Bearer', expires_in: 900, scope: 'doc_rwd' });
  }
  send(res, 404, { error: 'not_found' });
}

// ── Mock Carbone API ──────────────────────────────────────────────────────────

const carboneCalls: { url: string; auth?: string }[] = [];
/** Keys the Carbone API answers 401 to. */
let refusedKey: (key: string) => boolean = () => false;
let carboneServer: Server;
let carboneUrl: string;

async function carboneApi(req: IncomingMessage, res: ServerResponse) {
  for await (const _ of req); // drain
  carboneCalls.push({ url: req.url!, auth: req.headers.authorization });
  const key = req.headers.authorization?.replace(/^Bearer /, '');
  if (key && refusedKey(key)) return send(res, 401, { success: false, error: 'Invalid or expired token' });
  if (req.url === '/templates/tags') return send(res, 200, { success: true, data: [{ id: '1', name: 'a' }] });
  send(res, 404, { success: false, error: 'Not found' });
}
const carboneAuths = () => carboneCalls.map((c) => c.auth);

// ── MCP servers ───────────────────────────────────────────────────────────────

const signals = ['SIGTERM', 'SIGINT'] as const;
const listenersBefore = signals.map((s) => process.listeners(s));
const started: Server[] = [];

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) {
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function mcpServer(options: { oauth?: OAuthConfig; mcpPath?: string; serverKey?: string; requireClientAuth?: boolean }) {
  const client = new CarboneClient({
    apiKey: options.serverKey, baseUrl: carboneUrl, transport: 'http', requireClientAuth: options.requireClientAuth ?? !!options.oauth,
  });
  const server = await startHttpServer({
    client, version: '0.0.0-test', port: 0, mcpPath: options.mcpPath ?? '/', maxBodyBytes: MAX_BODY_BYTES,
    maxFileBytes: MAX_BODY_BYTES, allowPrivateNetwork: false, allowedOriginHostnames: [], oauth: options.oauth,
  });
  started.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  ({ server: asServer, url: asUrl } = await listen(authorizationServer));
  ({ server: carboneServer, url: carboneUrl } = await listen(carboneApi));
});

afterAll(async () => {
  // startHttpServer installs process-wide shutdown handlers (they call process.exit): remove them.
  for (const [i, s] of signals.entries()) {
    for (const l of process.listeners(s)) if (!listenersBefore[i].includes(l)) process.removeListener(s, l);
  }
  for (const server of [...started, asServer, carboneServer]) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  stderr.mockRestore();
  // The sweep, over whatever ran in this file (all of it, or a filtered part): no token, secret or
  // Authorization header ever reached stderr.
  for (const secret of secretsSeen) expect(log).not.toContain(secret);
  expect(log).not.toMatch(/Bearer |Basic |authorization:/i);
});

const eras = [
  { label: 'legacy (initialize)', mode: undefined },
  { label: `pinned ${MODERN}`, mode: { pin: MODERN } },
] as const;

async function connect(url: string, bearer: string | undefined, mode?: VersionNegotiationMode) {
  const client = new Client({ name: 'generic-client', version: '1.0.0' }, mode ? { versionNegotiation: { mode } } : undefined);
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, ...(bearer && { Authorization: `Bearer ${bearer}` }) };
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
  return client;
}

/** Connect, call list_tags, close. */
async function listTags(url: string, bearer: string | undefined, mode?: VersionNegotiationMode) {
  const client = await connect(url, bearer, mode);
  try {
    return await client.callTool({ name: 'list_tags', arguments: {} });
  } finally {
    await client.close();
  }
}

/** A raw tools/call (legacy, stateless), time-bounded. */
function rawToolsCall(url: string, headers: Record<string, string> = {}, method = 'POST') {
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: method === 'POST' ? JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tags', arguments: {} } }) : undefined,
    signal: AbortSignal.timeout(5_000),
  });
}

async function expectChallenge(res: Response, metadataUrl = `${RESOURCE}/.well-known/oauth-protected-resource`) {
  expect(res.status).toBe(401);
  const challenge = res.headers.get('www-authenticate')!;
  expect(challenge).toMatch(/^Bearer error="invalid_token", error_description="[^"]+"/);
  expect(challenge).toContain(`resource_metadata="${metadataUrl}"`);
  expect(challenge).toContain('scope="doc_rwd"');
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  expect(res.headers.get('access-control-expose-headers')).toBe('WWW-Authenticate, Mcp-Session-Id, Retry-After');
  expect((await res.json()).error).toBe('invalid_token');
}

/** No credentials: the challenge without an error code (RFC 6750 §3.1), still readable through CORS. */
async function expectBareChallenge(res: Response, metadataUrl = `${RESOURCE}/.well-known/oauth-protected-resource`) {
  expect(res.status).toBe(401);
  expect(res.headers.get('www-authenticate')).toBe(`Bearer scope="doc_rwd", resource_metadata="${metadataUrl}"`);
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  expect(res.headers.get('access-control-expose-headers')).toBe('WWW-Authenticate, Mcp-Session-Id, Retry-After');
  expect(await res.text()).toBe('');
}

// ── OAuth mode, origin-only resource (the hosted setup: MCP_PATH "/") ─────────

describe('OAuth mode (origin-only resource, MCP_PATH "/")', () => {
  let url: string;
  beforeAll(async () => {
    // A server key is configured here on purpose (config refuses one in OAuth mode): it must never be spent.
    url = await mcpServer({
      oauth: { issuer: asUrl, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, resourceUrl: RESOURCE }, serverKey: SERVER_KEY,
    });
  });

  describe.each(eras)('generic SDK client, $label', ({ mode }) => {
    test('an opaque Bearer: list_tags reaches the Carbone API with the exchanged JWT, never the opaque token', async () => {
      const token = grant();
      const callsBefore = carboneCalls.length;
      const result = await listTags(url, token, mode);
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ tags: ['a'] });

      const [exchangedJwt] = as.issued.get(token)!;
      expect(carboneCalls.slice(callsBefore)).toEqual([{ url: '/templates/tags', auth: `Bearer ${exchangedJwt}` }]);
      expect(carboneAuths().some((auth) => auth?.includes(token))).toBe(false);
      // Spec test 4: every request of the session (handshake, list, call) shares one introspection and one exchange.
      expect(as.introspected.filter((t) => t === token)).toHaveLength(1);
      expect(as.exchanged.filter((t) => t === token)).toHaveLength(1);
    });

    test('a Bearer Carbone API key reaches the Carbone API as is, with no introspection and no exchange', async () => {
      const key = apiKey();
      secretsSeen.add(key);
      const [introspections, exchanges] = [as.introspected.length, as.exchanged.length];
      const result = await listTags(url, key, mode);
      expect(result.isError).toBeFalsy();
      expect(carboneCalls.at(-1)).toEqual({ url: '/templates/tags', auth: `Bearer ${key}` });
      expect([as.introspected.length, as.exchanged.length]).toEqual([introspections, exchanges]);
    });

    test('no Bearer: the client is refused with HTTP 401, and nothing reaches the AS or Carbone', async () => {
      const [introspections, calls] = [as.introspected.length, carboneCalls.length];
      await expect(connect(url, undefined, mode)).rejects.toMatchObject({ data: { status: 401 } });
      expect([as.introspected.length, carboneCalls.length]).toEqual([introspections, calls]);
    });
  });

  test('spec test 2: no Bearer → 401 challenge without an error code, exposed through CORS', async () => {
    await expectBareChallenge(await rawToolsCall(url));
  });

  test('a malformed Bearer → 400 invalid_request, and nothing reaches the AS', async () => {
    const introspections = as.introspected.length;
    const res = await rawToolsCall(url, { Authorization: 'Bearer two tokens' });
    expect(res.status).toBe(400);
    expect(res.headers.get('www-authenticate')).toMatch(/^Bearer error="invalid_request", error_description="[^"]+", scope="doc_rwd", resource_metadata="/);
    expect((await res.json()).error).toBe('invalid_request');
    expect(as.introspected.length).toBe(introspections);
  });

  test('spec test 2: an inactive token, and a token bound to another resource → 401', async () => {
    await expectChallenge(await rawToolsCall(url, { Authorization: `Bearer ${opaque()}` }));
    const otherResource = grant({ aud: 'https://other.example.test' });
    await expectChallenge(await rawToolsCall(url, { Authorization: `Bearer ${otherResource}` }));
    expect(as.exchanged).not.toContain(otherResource);
  });

  test('every MCP request is gated: a GET without a token gets the challenge, not 405', async () => {
    await expectBareChallenge(await rawToolsCall(url, {}, 'GET'));
  });

  test('a token without doc_rwd → 403 insufficient_scope', async () => {
    const res = await rawToolsCall(url, { Authorization: `Bearer ${grant({ scope: 'profile' })}` });
    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate')).toMatch(/^Bearer error="insufficient_scope".*scope="doc_rwd"/);
  });

  test('a token revoked between its introspection and its exchange → the 401 challenge, then no more requests for it', async () => {
    const token = grant();
    as.rejectExchange.add(token);
    await expectChallenge(await rawToolsCall(url, { Authorization: `Bearer ${token}` }));
    const [introspections, exchanges] = [as.introspected.length, as.exchanged.length];
    await expectChallenge(await rawToolsCall(url, { Authorization: `Bearer ${token}` }));
    expect([as.introspected.length, as.exchanged.length]).toEqual([introspections, exchanges]);
  });

  test('spec test 5: the Carbone API refuses the exchanged JWT once → one new exchange, and the retry succeeds', async () => {
    const token = grant();
    let first: string | undefined;
    refusedKey = (key) => (first ??= key) === key;
    try {
      const result = await listTags(url, token);
      expect(result.isError).toBeFalsy();
    } finally {
      refusedKey = () => false;
    }
    const issued = as.issued.get(token)!;
    expect(issued).toHaveLength(2);
    expect(carboneAuths().slice(-2)).toEqual(issued.map((jwt) => `Bearer ${jwt}`));
  });

  test('spec test 5: refused twice → an authentication tool error, and no third exchange', async () => {
    const token = grant();
    refusedKey = (key) => (as.issued.get(token) ?? []).includes(key);
    try {
      const result = await listTags(url, token);
      expect(result.isError).toBe(true);
      expect((result.content as { text: string }[])[0].text).toMatch(/^Authentication failed/);
    } finally {
      refusedKey = () => false;
    }
    expect(as.issued.get(token)).toHaveLength(2);
  });

  test('spec test 7: a test_ JWT (a test account) is forwarded like a test API key', async () => {
    const token = grant({ testAccount: true });
    expect((await listTags(url, token)).isError).toBeFalsy();
    const [testJwt] = as.issued.get(token)!;
    expect(testJwt.startsWith('test_')).toBe(true);
    expect(carboneCalls.at(-1)!.auth).toBe(`Bearer ${testJwt}`);
  });

  test('an invalid API key stays a tool-level auth error, not an HTTP 401 challenge', async () => {
    const key = apiKey();
    secretsSeen.add(key);
    refusedKey = (k) => k === key;
    try {
      const result = await listTags(url, key);
      expect(result.isError).toBe(true);
      expect((result.content as { text: string }[])[0].text).toMatch(/^Authentication failed/);
    } finally {
      refusedKey = () => false;
    }
    expect(as.introspected).not.toContain(key);
  });

  test('spec test 1: the PRM answers GET/HEAD/OPTIONS, open to any Origin', async () => {
    const prm = `${url}/.well-known/oauth-protected-resource`;
    const res = await fetch(prm, { headers: { Origin: 'https://evil.example' }, signal: AbortSignal.timeout(5_000) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const doc = await res.json();
    expect(doc.resource).toBe(RESOURCE); // strictly, no trailing slash
    expect(doc).toEqual({ resource: RESOURCE, authorization_servers: [asUrl], scopes_supported: ['doc_rwd'], bearer_methods_supported: ['header'] });

    const head = await fetch(prm, { method: 'HEAD', signal: AbortSignal.timeout(5_000) });
    expect([head.status, await head.text()]).toEqual([200, '']);
    const preflight = await fetch(prm, { method: 'OPTIONS', signal: AbortSignal.timeout(5_000) });
    expect([preflight.status, preflight.headers.get('access-control-allow-origin')]).toEqual([204, '*']);
    expect((await fetch(prm, { method: 'POST', signal: AbortSignal.timeout(5_000) })).status).toBe(405);
  });

  test('spec test 6: no request ever spent the server key', () => {
    expect(carboneAuths()).not.toContain(`Bearer ${SERVER_KEY}`);
  });
});

// ── OAuth mode, resource with a path ──────────────────────────────────────────

describe('OAuth mode (resource with a path, MCP_PATH "/mcp")', () => {
  const resource = `${RESOURCE}/mcp`;
  let url: string;
  beforeAll(async () => {
    url = await mcpServer({ oauth: { issuer: asUrl, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, resourceUrl: resource }, mcpPath: '/mcp' });
  });

  test('both well-known paths serve the document, with the resource as configured', async () => {
    for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      const res = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(5_000) });
      expect(res.status).toBe(200);
      expect((await res.json()).resource).toBe(resource);
    }
  });

  test('the challenge points at the path-suffixed metadata URL', async () => {
    await expectBareChallenge(await rawToolsCall(`${url}/mcp`), `${RESOURCE}/.well-known/oauth-protected-resource/mcp`);
  });
});

// ── OAuth mode: flood protection, behind one trusted reverse proxy ────────────

/** A POST announcing a `bytes`-long body and sending only its first 64 KiB: the response must come before the rest. */
function postUnsentBody(url: string, bytes: number, headers: Record<string, string> = {}): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Content-Length': String(bytes), ...headers },
    }, (res) => { res.resume(); resolve(res); req.destroy(); });
    req.on('error', reject);
    req.write(Buffer.alloc(64 * 1024, 0x20));
    setTimeout(() => reject(new Error('no answer before the upload ended')), 5_000).unref();
  });
}

describe('OAuth mode: flood protection (MCP_TRUST_PROXY_HOPS 1)', () => {
  let url: string;
  beforeAll(async () => {
    url = await mcpServer({
      oauth: { issuer: asUrl, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, resourceUrl: RESOURCE, trustProxyHops: 1 },
    });
  });
  /** As the proxy forwards it: the client's own (untrusted) claim, then the address the proxy saw. */
  const from = (address: string, token?: string) => ({
    'X-Forwarded-For': `192.0.2.254, ${address}`, ...(token !== undefined && { Authorization: `Bearer ${token}` }),
  });

  test('a request without a valid token is answered before its body is read, and its connection closed', async () => {
    for (const headers of [from('203.0.113.40'), from('203.0.113.40', opaque())]) {
      const res = await postUnsentBody(url, MAX_BODY_BYTES * 4, headers);
      expect(res.statusCode).toBe(401);
      expect(res.headers.connection).toBe('close');
    }
  });

  test('under pressure, an address that keeps sending unknown tokens gets 429; nobody else is limited', async () => {
    const signedIn = grant();
    expect((await rawToolsCall(url, from('203.0.113.50', signedIn))).status).toBe(200);
    const introspections = as.introspected.length;
    // Without pressure nobody is limited, a shared address included
    for (let i = 0; i < 60; i++) expect((await rawToolsCall(url, from('203.0.113.50', opaque()))).status).toBe(401);
    // Pressure: 9 other addresses check 50 unknown tokens each, past half of the all-clients budget
    await Promise.all(Array.from({ length: 9 }, async (_, a) => {
      for (let i = 0; i < 50; i++) expect((await rawToolsCall(url, from(`198.51.100.${a + 10}`, opaque()))).status).toBe(401);
    }));
    // The part of X-Forwarded-For the client wrote is never trusted: changing it changes nothing
    const res = await rawToolsCall(url, { 'X-Forwarded-For': '192.0.2.99, 203.0.113.50', Authorization: `Bearer ${opaque()}` });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(as.introspected.length - introspections).toBe(60 + 450);
    expect((await rawToolsCall(url, from('203.0.113.50', signedIn))).status).toBe(200);
    expect((await rawToolsCall(url, from('203.0.113.50'))).status).toBe(401);
    expect((await rawToolsCall(url, from('203.0.113.51', opaque()))).status).toBe(401);
  });

  test('spec test 7: introspection 5xx → 503 with Retry-After, never 401; for an unseen token it pauses nobody else', async () => {
    const signedIn = grant();
    expect((await rawToolsCall(url, from('203.0.113.60', signedIn))).status).toBe(200);
    const token = grant();
    as.failIntrospection.add(token);
    const res = await rawToolsCall(url, from('203.0.113.60', token));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('7');
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(await res.json()).toEqual({
      jsonrpc: '2.0', error: { code: -32000, message: expect.stringContaining('authorization server'), data: { error: 'server_error' } }, id: null,
    });
    // A token picked to make the authorization server fail cannot stop sign-ins for everyone
    expect((await rawToolsCall(url, from('203.0.113.60', grant()))).status).toBe(200);
    expect((await rawToolsCall(url, from('203.0.113.60', signedIn))).status).toBe(200);
  });
});

// ── Spec test 8: API-key mode, unchanged ──────────────────────────────────────

describe('API-key mode (no MCP_OAUTH_* variable): unchanged', () => {
  let sharedKeyUrl: string;
  let requireKeyUrl: string;
  beforeAll(async () => {
    sharedKeyUrl = await mcpServer({ serverKey: SERVER_KEY, requireClientAuth: false });
    requireKeyUrl = await mcpServer({ serverKey: SERVER_KEY, requireClientAuth: true });
  });

  test.each(eras)('a Bearer is forwarded as is, API key or not, with no introspection or exchange ($label)', async ({ mode }) => {
    const [introspections, exchanges] = [as.introspected.length, as.exchanged.length];
    for (const bearer of [apiKey(), opaque()]) {
      secretsSeen.add(bearer);
      expect((await listTags(sharedKeyUrl, bearer, mode)).isError).toBeFalsy();
      expect(carboneCalls.at(-1)!.auth).toBe(`Bearer ${bearer}`);
    }
    expect([as.introspected.length, as.exchanged.length]).toEqual([introspections, exchanges]);
  });

  test('/.well-known/oauth-protected-resource answers 404, and there is no 401 challenge', async () => {
    expect((await fetch(`${sharedKeyUrl}/.well-known/oauth-protected-resource`, { signal: AbortSignal.timeout(5_000) })).status).toBe(404);
    const res = await rawToolsCall(requireKeyUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('www-authenticate')).toBeNull();
  });

  test('no Bearer: the server key is the fallback, as before', async () => {
    expect((await listTags(sharedKeyUrl, undefined)).isError).toBeFalsy();
    expect(carboneCalls.at(-1)!.auth).toBe(`Bearer ${SERVER_KEY}`);
  });

  test('no Bearer with CARBONE_REQUIRE_CLIENT_AUTH_HEADER: the existing tool-level refusal', async () => {
    const calls = carboneCalls.length;
    const result = await listTags(requireKeyUrl, undefined);
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toContain('No API key provided');
    expect(carboneCalls.length).toBe(calls);
  });
});

// ── Logging ───────────────────────────────────────────────────────────────────

describe('logging', () => {
  // The check that no secret is logged runs once every test of this file is done (afterAll above).
  test('stderr is captured, so that end-of-file check reads the real output', async () => {
    const url = await mcpServer({ oauth: { issuer: asUrl, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, resourceUrl: RESOURCE } });
    expect((await rawToolsCall(url)).status).toBe(401);
    await vi.waitFor(() => expect(log).toContain('[carbone-mcp] POST / 401'));
  });
});
