import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  Client,
  StreamableHTTPClientTransport,
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  type VersionNegotiationMode,
} from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { CarboneClient } from '../../src/carbone/client.js';
import { startHttpServer } from '../../src/server/http.js';

/**
 * Both transports must serve the 2026-07-28 protocol revision AND 2025-era (`initialize`) clients.
 * Everything runs locally against a mock Carbone API, so no API key or network is needed:
 * HTTP in process (port 0), stdio as a child process running the TypeScript entry point via tsx.
 */

const MODERN = '2026-07-28';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const SERVER_KEY = 'server-key';
const ALLOWED_ORIGIN_HOST = 'app.example.com';
// The tool and resource lists never change, so list changes are not advertised (no idle listen streams).
const CAPABILITIES = { tools: { listChanged: false }, resources: { listChanged: false }, completions: {} };

// ── Mock Carbone API: records the Authorization header of every call ────────
const calls: { url: string; auth?: string }[] = [];
let mockServer: Server;
let mockUrl: string;

function json(res: ServerResponse, body: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

/** The Authorization header the mock saw on the most recent call to `url`. */
function lastAuthFor(url: string) {
  return calls.filter((c) => c.url === url).at(-1)?.auth;
}

// ── Slow render: the next render is answered only after RENDER_DELAY_MS ─────
const RENDER_DELAY_MS = 10_000;
let holdNextRender: ((res: ServerResponse) => void) | undefined;

/**
 * Stall the next POST /render/template either before the response or mid-body. `started` resolves when
 * the request reaches the mock, `closed` when its connection closes (normally only after the delay).
 */
function slowNextRender(stall: 'before-response' | 'mid-body') {
  let started!: () => void;
  let closed!: () => void;
  const upstream = { started: new Promise<void>((r) => (started = r)), closed: new Promise<void>((r) => (closed = r)) };
  holdNextRender = (res) => {
    if (stall === 'mid-body') res.writeHead(200, { 'Content-Type': 'application/pdf' }).write('%PDF-1.4 ');
    const timer = setTimeout(() => res.end('slow render'), RENDER_DELAY_MS);
    res.on('close', () => { clearTimeout(timer); closed(); });
    started();
  };
  return upstream;
}

const newClient = (mode?: VersionNegotiationMode) =>
  new Client({ name: 'protocol-eras-test', version: '0' }, mode ? { versionNegotiation: { mode } } : undefined);

const eras = [
  { label: 'default (legacy)', mode: undefined, era: 'legacy', key: 'legacy-client-key' },
  { label: `pinned ${MODERN}`, mode: { pin: MODERN }, era: 'modern', key: 'pinned-client-key' },
  { label: 'auto', mode: 'auto', era: 'modern', key: 'auto-client-key' },
] as const;

beforeAll(async () => {
  mockServer = createServer(async (req, res) => {
    for await (const _ of req); // drain the body (convert_document posts several MiB)
    calls.push({ url: req.url!, auth: req.headers.authorization });
    if (req.method === 'GET' && req.url === '/templates/tags') {
      return json(res, { success: true, data: [{ id: '1', name: 'a' }] });
    }
    if (req.method === 'GET' && req.url === '/templates') {
      return json(res, { success: true, data: [{ id: '1', name: 'Invoice' }], hasMore: false });
    }
    if (req.method === 'POST' && req.url === '/render/template?download=true') {
      const hold = holdNextRender;
      holdNextRender = undefined;
      if (hold) return hold(res);
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="out.pdf"' });
      return res.end('%PDF-1.4 mock');
    }
    res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: false, error: 'Not found' }));
  });
  await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  mockUrl = `http://127.0.0.1:${(mockServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  mockServer.closeAllConnections();
  await new Promise((resolve) => mockServer.close(resolve));
});

// ── Streamable HTTP ─────────────────────────────────────────────────────────
describe('HTTP transport serves both protocol eras', () => {
  let httpServer: Server;
  let mcpUrl: string;
  const signals = ['SIGTERM', 'SIGINT'] as const;
  let listenersBefore: unknown[][] = [];

  beforeAll(async () => {
    const carbone = new CarboneClient({ apiKey: SERVER_KEY, baseUrl: mockUrl, transport: 'http' });
    listenersBefore = signals.map((s) => process.listeners(s));
    httpServer = await startHttpServer({
      client: carbone, version: '0.0.0-test', port: 0, mcpPath: '/mcp',
      maxBodyBytes: MAX_BODY_BYTES, maxFileBytes: 100 * 1024 * 1024, allowPrivateNetwork: false,
      allowedOriginHostnames: [ALLOWED_ORIGIN_HOST],
    });
    mcpUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
  });

  afterAll(async () => {
    // startHttpServer installs process-wide shutdown handlers (they call process.exit); remove them
    // so they never fire on the test worker.
    for (const [i, s] of signals.entries()) {
      for (const l of process.listeners(s)) if (!listenersBefore[i].includes(l)) process.removeListener(s, l);
    }
    httpServer.closeAllConnections();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  async function connect(key: string, mode?: VersionNegotiationMode) {
    const client = newClient(mode);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${key}` } } })
    );
    return client;
  }

  /** Raw POST to the MCP endpoint, time-bounded so a hanging request fails the test. */
  function post(body: string, headers: Record<string, string> = {}) {
    return fetch(mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
      body,
      signal: AbortSignal.timeout(5_000),
    });
  }

  /** A 2026-07-28 request body: the per-request `_meta` envelope claims the protocol version. */
  function modernBody(method: string, params: Record<string, unknown> = {}, version = MODERN) {
    const _meta = {
      [PROTOCOL_VERSION_META_KEY]: version,
      [CLIENT_INFO_META_KEY]: { name: 'raw', version: '0' },
      [CLIENT_CAPABILITIES_META_KEY]: {},
    };
    return JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta } });
  }

  describe.each(eras)('$label client', ({ mode, era, key }) => {
    let client: Client;
    beforeAll(async () => { client = await connect(key, mode); });
    afterAll(async () => { await client.close(); });

    test(`negotiates the ${era} era and lists all 12 tools`, async () => {
      expect(client.getProtocolEra()).toBe(era);
      if (era === 'modern') expect(client.getNegotiatedProtocolVersion()).toBe(MODERN);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(12);
    });

    test(`advertises static tool and resource lists (${era === 'modern' ? 'server/discover' : 'initialize'})`, () => {
      expect(client.getServerCapabilities()).toEqual(CAPABILITIES);
    });

    test('a tool call reaches the Carbone API with the client Bearer key', async () => {
      const result = await client.callTool({ name: 'list_tags', arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ tags: ['a'] });
      expect(lastAuthFor('/templates/tags')).toBe(`Bearer ${key}`);
    });

    test('a request body over 4 MiB but under MCP_MAX_BODY_BYTES is served', async () => {
      const file = Buffer.alloc(3_900_000, 'carbone').toString('base64'); // ~5.2 MB of base64
      const result = await client.callTool({ name: 'convert_document', arguments: { file, convertTo: 'pdf' } });
      expect(result.isError).toBeFalsy();
      expect(result.content[0]).toMatchObject({ type: 'resource', resource: { mimeType: 'application/pdf' } });
      expect(lastAuthFor('/render/template?download=true')).toBe(`Bearer ${key}`);
    });
  });

  test(`a ${MODERN} client opting in to list-change notifications opens no subscription stream`, async () => {
    const onChanged = () => {};
    const client = new Client({ name: 'protocol-eras-test', version: '0' }, {
      versionNegotiation: { mode: { pin: MODERN } },
      listChanged: { tools: { onChanged }, resources: { onChanged } },
    });
    await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
    try {
      expect(client.autoOpenedSubscription).toBeUndefined();
    } finally {
      await client.close();
    }
  });

  test('a raw subscriptions/listen for list changes ends right after the ack', async () => {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'subscriptions/listen',
      },
      body: modernBody('subscriptions/listen', { notifications: { toolsListChanged: true, resourcesListChanged: true } }),
      signal: AbortSignal.timeout(2_000), // a stream left open (with keep-alives) fails the test here
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('notifications/subscriptions/acknowledged');
  });

  test('modern resources/read results carry ttlMs and cacheScope "private"', async () => {
    const res = await post(modernBody('resources/read', { uri: 'carbone://tags' }), {
      Authorization: 'Bearer raw-key', 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'resources/read', 'Mcp-Name': 'carbone://tags',
    });
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result).toMatchObject({ resultType: 'complete', cacheScope: 'private', contents: [{ text: '["a"]' }] });
    expect(typeof result.ttlMs).toBe('number');
    expect(lastAuthFor('/templates/tags')).toBe('Bearer raw-key');
  });

  test('modern request without MCP-Protocol-Version → 400 HeaderMismatch (-32020)', async () => {
    const res = await post(modernBody('tools/list'), { 'Mcp-Method': 'tools/list' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32020);
  });

  test('unsupported protocol version → 400 -32022 listing the supported versions', async () => {
    const res = await post(modernBody('tools/list', {}, '2099-01-01'), { 'MCP-Protocol-Version': '2099-01-01', 'Mcp-Method': 'tools/list' });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error.code).toBe(-32022);
    expect(error.data.supported).toContain(MODERN);
  });

  test('unknown method → 404 -32601', async () => {
    const res = await post(modernBody('carbone/unknown'), { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'carbone/unknown' });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe(-32601);
  });

  test('GET on the endpoint → 405', async () => {
    const res = await fetch(mcpUrl, { headers: { Accept: 'text/event-stream' }, signal: AbortSignal.timeout(5_000) });
    expect(res.status).toBe(405);
  });

  test('CORS preflight allows the modern request headers', async () => {
    const res = await fetch(mcpUrl, { method: 'OPTIONS', signal: AbortSignal.timeout(5_000) });
    expect(res.status).toBe(204);
    const allowed = res.headers.get('access-control-allow-headers')!.toLowerCase().split(/\s*,\s*/);
    expect(allowed).toEqual(expect.arrayContaining(['mcp-protocol-version', 'mcp-method', 'mcp-name', 'authorization']));
  });

  test('malformed JSON → 400 JSON-RPC parse error', async () => {
    const res = await post('{"jsonrpc": "2.0",');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ jsonrpc: '2.0', error: { code: -32700, message: expect.any(String) }, id: null });
  });

  test('empty body → prompt 400 JSON-RPC parse error', async () => {
    const res = await post('');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32700);
  });

  test('body over MCP_MAX_BODY_BYTES → 413', async () => {
    const res = await post('x'.repeat(MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
  });

  // DNS-rebinding protection: a present Origin must be localhost-class or allowlisted, else 403.
  describe('Origin validation', () => {
    const toolCall = {
      legacy: (headers: Record<string, string>) =>
        post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tags', arguments: {} } }), headers),
      modern: (headers: Record<string, string>) =>
        post(modernBody('tools/call', { name: 'list_tags', arguments: {} }), {
          'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'list_tags', ...headers,
        }),
    };

    describe.each(['legacy', 'modern'] as const)('%s tools/call', (era) => {
      const served = [undefined, 'http://localhost:6274', 'http://127.0.0.1:1234', 'http://[::1]:3000', `https://${ALLOWED_ORIGIN_HOST}`];
      test.each(served)('Origin %s → served', async (origin) => {
        const before = calls.length;
        const res = await toolCall[era](origin ? { Origin: origin } : {});
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('"tags":["a"]');
        expect(calls.length).toBe(before + 1);
      });

      test.each(['https://evil.example', 'http://localhost.evil.example', 'null'])('Origin %s → 403, Carbone API never called', async (origin) => {
        const before = calls.length;
        const res = await toolCall[era]({ Origin: origin });
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32000 }, id: null });
        expect(calls.length).toBe(before);
      });
    });

    test.each(['GET', 'DELETE'])('%s with a foreign Origin → 403 (checked before the 405)', async (method) => {
      const res = await fetch(mcpUrl, { method, headers: { Origin: 'https://evil.example' }, signal: AbortSignal.timeout(5_000) });
      expect(res.status).toBe(403);
    });
  });

  // Cancelling a tool call must stop the upstream render, not leave it running for the full delay.
  // Modern clients cancel by closing the response stream (aborting the call). A 2025 client instead
  // sends notifications/cancelled, which a stateless server cannot tie to the in-flight request, so
  // for it the covered case is a disconnect.
  describe.each(eras.filter((e) => e.mode !== 'auto'))('cancellation — $label client', ({ mode, era, key }) => {
    test.each(['before-response', 'mid-body'] as const)('cancelling convert_document closes the upstream call (%s)', async (stall) => {
      const client = await connect(key, mode);
      try {
        const upstream = slowNextRender(stall);
        const controller = new AbortController();
        const call = client.callTool(
          { name: 'convert_document', arguments: { file: 'aGVsbG8=', convertTo: 'pdf' } },
          { signal: controller.signal }
        );
        await upstream.started;
        const abortedAt = Date.now();
        await (era === 'modern' ? controller.abort() : client.close());
        await expect(call).rejects.toThrow();
        await upstream.closed; // without propagation this waits RENDER_DELAY_MS and the test times out
        expect(Date.now() - abortedAt).toBeLessThan(2_000);
      } finally {
        await client.close();
      }
    });
  });
});

// ── stdio ───────────────────────────────────────────────────────────────────
describe('stdio transport serves both protocol eras', () => {
  const STDIO_KEY = 'stdio-env-key';
  // Run the TypeScript entry point directly (tsx is a devDependency), so no build is needed.
  const command = process.execPath;
  const args = ['--import', 'tsx', 'src/index.ts'];
  const env = () => ({ ...getDefaultEnvironment(), CARBONE_API_KEY: STDIO_KEY, CARBONE_BASE_URL: mockUrl });

  test.each(eras.filter((e) => e.mode !== 'auto'))('$label client connects and calls a tool with the env key', async ({ mode, era }) => {
    const client = newClient(mode);
    await client.connect(new StdioClientTransport({ command, args, cwd: ROOT, env: env(), stderr: 'ignore' }));
    try {
      expect(client.getProtocolEra()).toBe(era);
      if (era === 'modern') expect(client.getNegotiatedProtocolVersion()).toBe(MODERN);
      expect(client.getServerCapabilities()).toEqual(CAPABILITIES);
      expect((await client.listTools()).tools).toHaveLength(12);
      const result = await client.callTool({ name: 'list_templates', arguments: {} });
      expect(result.structuredContent).toMatchObject({ templates: [{ id: '1' }], hasMore: false });
      expect(lastAuthFor('/templates')).toBe(`Bearer ${STDIO_KEY}`);
    } finally {
      await client.close();
    }
  }, 30_000);

  test.each(eras.filter((e) => e.mode !== 'auto'))('$label client: notifications/cancelled closes the upstream call', async ({ mode }) => {
    const client = newClient(mode);
    await client.connect(new StdioClientTransport({ command, args, cwd: ROOT, env: env(), stderr: 'ignore' }));
    try {
      const upstream = slowNextRender('before-response');
      const controller = new AbortController();
      const call = client.callTool(
        { name: 'convert_document', arguments: { file: 'aGVsbG8=', convertTo: 'pdf' } },
        { signal: controller.signal }
      );
      await upstream.started;
      const abortedAt = Date.now();
      controller.abort(); // the client sends notifications/cancelled on the open connection
      await expect(call).rejects.toThrow();
      await upstream.closed;
      expect(Date.now() - abortedAt).toBeLessThan(2_000);
    } finally {
      await client.close();
    }
  }, 30_000);

  test('the server process exits on its own once stdin is closed', async () => {
    const child: ChildProcess = spawn(command, args, { cwd: ROOT, env: env(), stdio: ['pipe', 'pipe', 'ignore'] });
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    try {
      const lines = createInterface({ input: child.stdout! });
      const reply = (id: number) => new Promise<unknown>((resolve) => {
        lines.on('line', (line) => { const msg = JSON.parse(line); if (msg.id === id) resolve(msg); });
      });
      const send = (msg: object) => child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

      // A full legacy session including an upstream API call, so live keep-alive sockets are in play.
      send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '0' } } });
      await reply(1);
      send({ method: 'notifications/initialized' });
      send({ id: 2, method: 'tools/call', params: { name: 'list_tags', arguments: {} } });
      expect(await reply(2)).toMatchObject({ result: { structuredContent: { tags: ['a'] } } });

      child.stdin!.end();
      const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 3_000).unref());
      expect(await Promise.race([exited, timeout])).toBe(0);
    } finally {
      child.kill();
    }
  }, 30_000);
});
