import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { connect as tcpConnect, type AddressInfo } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { Client, StreamableHTTPClientTransport, type VersionNegotiationMode } from '@modelcontextprotocol/client';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import { CarboneClient } from '../../src/carbone/client.js';
import { startHttpServer } from '../../src/server/http.js';

/**
 * The HTTP access line, on a real server in API-key mode (port 0) against a mock Carbone API: the tool called and
 * its outcome (recorded by the tool callback, so it must run in the request's async context, in both protocol eras),
 * the caller as a key fingerprint, the request id, and the platform's own /health probes left out.
 */

const MODERN = '2026-07-28';
/** Keys the mock Carbone API refuses, keys it is unavailable for (503), and keys it answers only after SLOW_MS. */
const REFUSED = 'refused-';
const DOWN = 'down-';
const SLOW = 'slow-';
const SLOW_MS = 300;

let log = '';
const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
  log += String(chunk);
  return true;
});
const keysSeen: string[] = [];
const newKey = (prefix = '') => {
  const key = `${prefix}key-${randomBytes(8).toString('hex')}`;
  keysSeen.push(key);
  return key;
};
const fingerprint = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 12);
const lines = () => log.split('\n');
/** The access lines of the requests made with `key`. */
const linesOf = (key: string) => lines().filter((line) => line.includes(` user=key:${fingerprint(key)} `));
/** The access line of the request sent "from" `ip` (an X-Forwarded-For entry past the loopback peer). */
const lineFrom = (ip: string) => lines().find((line) => line.startsWith('level=') && line.includes(` msg=request `) && line.includes(` ip=${ip} `));
const field = (line: string | undefined, name: string) => new RegExp(` ${name}=("(?:[^"\\\\]|\\\\.)*"|\\S+)`).exec(line ?? '')?.[1];

const signals = ['SIGTERM', 'SIGINT'] as const;
const listenersBefore = signals.map((s) => process.listeners(s));
let carbone: Server;
let server: Server;
let base: string;
/** Resolves when the mock Carbone API receives a slow request. */
let slowRequestArrived: () => void = () => {};

beforeAll(async () => {
  carbone = createServer(async (req, res) => {
    for await (const _ of req); // drain
    const key = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    if (key.includes(SLOW)) {
      slowRequestArrived();
      await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
    }
    if (key.startsWith(DOWN)) return res.writeHead(503, { 'Content-Type': 'text/plain' }).end('unavailable');
    const refused = key.startsWith(REFUSED);
    res.writeHead(refused ? 401 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(refused ? { success: false, error: 'Invalid or expired token' } : { success: true, data: [{ id: '1', name: 'a' }] }));
  });
  await new Promise<void>((resolve) => carbone.listen(0, '127.0.0.1', resolve));
  const client = new CarboneClient({ baseUrl: `http://127.0.0.1:${(carbone.address() as AddressInfo).port}`, transport: 'http' });
  server = await startHttpServer({
    client, version: '0.0.0-test', port: 0, mcpPath: '/mcp', maxBodyBytes: 1024 * 1024, maxFileBytes: 1024 * 1024,
    allowPrivateNetwork: false, allowedOriginHostnames: [],
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const [i, s] of signals.entries()) {
    for (const l of process.listeners(s)) if (!listenersBefore[i].includes(l)) process.removeListener(s, l);
  }
  for (const s of [server, carbone]) {
    s.closeAllConnections();
    await new Promise((resolve) => s.close(resolve));
  }
  stderr.mockRestore();
  // A key is only ever logged as its fingerprint
  for (const key of keysSeen) expect(log).not.toContain(key);
});

async function listTags(key: string, mode?: VersionNegotiationMode, name = 'list_tags') {
  const client = new Client({ name: 'access-log-test', version: '1.0.0' }, mode ? { versionNegotiation: { mode } } : undefined);
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  try {
    return await client.callTool({ name, arguments: {} });
  } finally {
    await client.close();
  }
}

/** One stateless JSON-RPC request, as a 2025-era client sends it after initialize. */
function rawCall(key: string, message: Record<string, unknown>, init: RequestInit = {}) {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...message }),
    ...init,
  });
}

const eras = [
  { label: 'legacy (initialize)', mode: undefined, client: '', proto: '2025-\\d\\d-\\d\\d' },
  // 2026-07-28 requests carry the client's name and version in every request's _meta
  { label: `pinned ${MODERN}`, mode: { pin: MODERN }, client: ' client=access-log-test/1.0.0', proto: MODERN },
] as const;

describe.each(eras)('$label: the tool call line', ({ mode, client, proto }) => {
  // The format contract: one full line
  test('a result: the tool, the key fingerprint and outcome=ok', async () => {
    const key = newKey();
    expect((await listTags(key, mode)).isError).toBeFalsy();
    await vi.waitFor(() => expect(log).toMatch(new RegExp(
      `^level=info msg=request method=POST path=/mcp status=200 ms=\\d+ ip=\\S+ mcp=tools/call tool=list_tags${client} proto=${proto} ua=node ` +
      `user=key:${fingerprint(key)} outcome=ok rid=[0-9a-f]{16}$`, 'm')));
  });

  test('a call the SDK refuses (unknown tool): outcome=error, level=warn', async () => {
    const key = newKey();
    await listTags(key, mode, 'no_such_tool').catch(() => undefined);
    const line = await vi.waitFor(() => {
      const found = linesOf(key).find((l) => l.includes(' mcp=tools/call '));
      expect(found).toBeDefined();
      return found!;
    });
    expect(line).toMatch(/^level=warn /);
    expect(field(line, 'outcome')).toBe('error');
  });

  test('a Carbone outage: level=error, error_type=upstream', async () => {
    const key = newKey(DOWN);
    expect((await listTags(key, mode)).isError).toBe(true);
    const line = await vi.waitFor(() => {
      const found = linesOf(key).find((l) => l.includes(' mcp=tools/call '));
      expect(found).toBeDefined();
      return found!;
    });
    expect(line).toMatch(/^level=error /);
    expect([field(line, 'outcome'), field(line, 'error_type')]).toEqual(['error', 'upstream']);
  });

  test('a tool error: level=warn, outcome=error and its text', async () => {
    const key = newKey(REFUSED);
    expect((await listTags(key, mode)).isError).toBe(true);
    const line = await vi.waitFor(() => {
      const found = linesOf(key).find((l) => l.includes(' mcp=tools/call '));
      expect(found).toBeDefined();
      return found!;
    });
    expect(line).toMatch(/^level=warn /);
    expect(field(line, 'outcome')).toBe('error');
    expect(field(line, 'error')).toMatch(/^"Authentication failed: Invalid or expired token /);
  });
});

test('initialize names the client', async () => {
  const key = newKey();
  await listTags(key);
  await vi.waitFor(() => expect(field(linesOf(key).find((l) => l.includes(' mcp=initialize ')), 'client')).toBe('access-log-test/1.0.0'));
});

test('a call the SDK refuses before the tool runs (invalid arguments, unknown tool) is outcome=error, level=warn', async () => {
  const invalid = newKey();
  const unknown = newKey();
  expect((await rawCall(invalid, { method: 'tools/call', params: { name: 'convert_document', arguments: { convertTo: 42 } } })).status).toBe(200);
  expect((await rawCall(unknown, { method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } })).status).toBe(200);
  for (const [key, tool] of [[invalid, 'convert_document'], [unknown, 'no_such_tool']]) {
    const line = await vi.waitFor(() => {
      expect(linesOf(key)).toHaveLength(1);
      return linesOf(key)[0];
    });
    expect(line).toMatch(/^level=warn /);
    expect(field(line, 'tool')).toBe(tool);
    expect(field(line, 'outcome')).toBe('error');
  }
});

test('resources/read: ok, a read that fails, and an unknown resource; an unknown method is an error too', async () => {
  const ok = newKey();
  const failed = newKey(REFUSED);
  const unknownResource = newKey();
  const unknownMethod = newKey();
  const read = (key: string, uri: string) => rawCall(key, { method: 'resources/read', params: { uri } });
  await read(ok, 'carbone://tags');
  await read(failed, 'carbone://tags');
  await read(unknownResource, 'carbone://nope');
  // The SDK's own answer is kept: a JSON-RPC "Method not found"
  const answer = await (await rawCall(unknownMethod, { method: 'foo/bar' })).text();
  expect(JSON.parse(/^data: (.*)$/m.exec(answer)?.[1] ?? answer)).toMatchObject({ error: { code: -32601, message: 'Method not found' } });
  const lineOf = (key: string) => vi.waitFor(() => {
    expect(linesOf(key)).toHaveLength(1);
    return linesOf(key)[0];
  });
  expect(field(await lineOf(ok), 'outcome')).toBe('ok');
  for (const key of [failed, unknownResource, unknownMethod]) {
    const line = await lineOf(key);
    expect(line).toMatch(/^level=warn /);
    expect(field(line, 'outcome')).toBe('error');
  }
  expect(field(await lineOf(failed), 'error')).toContain('Invalid or expired token');
  expect(field(await lineOf(unknownMethod), 'error')).toBe('"Method not found"');
});

test('the Carbone Skill: skills/list and a file read are info lines, a file the skill does not have is outcome=error', async () => {
  const listed = newKey();
  const read = newKey();
  const unknown = newKey();
  expect(await (await rawCall(listed, { method: 'skills/list', params: {} })).text()).toContain('skill://carbone/SKILL.md');
  expect(await (await rawCall(read, { method: 'resources/read', params: { uri: 'skill://carbone/references/formatters.md' } })).text())
    .toContain('formatC');
  // Codex's agents/openai.yaml is in the release, but not served
  await rawCall(unknown, { method: 'resources/read', params: { uri: 'skill://carbone/agents/openai.yaml' } });
  const lineOf = (key: string) => vi.waitFor(() => {
    expect(linesOf(key)).toHaveLength(1);
    return linesOf(key)[0];
  });
  const listLine = await lineOf(listed);
  expect(listLine).toMatch(/^level=info /);
  expect(field(listLine, 'mcp')).toBe('skills/list');
  expect(field(listLine, 'outcome')).toBeUndefined();
  const readLine = await lineOf(read);
  expect(readLine).toMatch(/^level=info /);
  expect(field(readLine, 'outcome')).toBe('ok');
  const unknownLine = await lineOf(unknown);
  expect(unknownLine).toMatch(/^level=warn /);
  expect(field(unknownLine, 'outcome')).toBe('error');
});

test(`${MODERN}: an unknown method keeps the SDK's 404, and is an error on the access line`, async () => {
  const key = newKey();
  const _meta = { [PROTOCOL_VERSION_META_KEY]: MODERN, [CLIENT_INFO_META_KEY]: { name: 'raw', version: '0' }, [CLIENT_CAPABILITIES_META_KEY]: {} };
  const res = await rawCall(key, { method: 'carbone/unknown', params: { _meta } }, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${key}`, 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'carbone/unknown' },
  });
  expect(res.status).toBe(404);
  const line = await vi.waitFor(() => {
    expect(linesOf(key)).toHaveLength(1);
    return linesOf(key)[0];
  });
  expect(line).toMatch(/^level=warn /);
  expect(field(line, 'status')).toBe('404');
  expect(field(line, 'outcome')).toBe('error');
});

test('one line per request; a client leaving before the answer still leaves one, with aborted=1', async () => {
  const done = newKey();
  expect((await rawCall(done, { method: 'tools/list' })).status).toBe(200);
  const gone = newKey(SLOW);
  const arrived = new Promise<void>((resolve) => { slowRequestArrived = resolve; });
  const leaving = new AbortController();
  const call = rawCall(gone, { method: 'tools/call', params: { name: 'list_tags', arguments: {} } }, { signal: leaving.signal });
  await arrived;
  leaving.abort();
  await expect(call).rejects.toThrow();
  await vi.waitFor(() => expect(linesOf(gone)).toHaveLength(1));
  expect(linesOf(gone)[0]).toMatch(/^level=info .* aborted=1 rid=/);
  expect(field(linesOf(gone)[0], 'outcome')).toBeUndefined();
  // Nothing more once the tool finishes
  await new Promise((resolve) => setTimeout(resolve, SLOW_MS + 100));
  expect(linesOf(gone)).toHaveLength(1);
  expect(linesOf(done)).toHaveLength(1);
  expect(field(linesOf(done)[0], 'aborted')).toBeUndefined();
});

test('concurrent requests: each line has its own caller, outcome and rid', async () => {
  const ok = newKey(SLOW);
  const refused = newKey(`${REFUSED}${SLOW}`);
  const call = (key: string) => rawCall(key, { method: 'tools/call', params: { name: 'list_tags', arguments: {} } });
  await Promise.all([call(ok), call(refused)]);
  await vi.waitFor(() => expect([linesOf(ok).length, linesOf(refused).length]).toEqual([1, 1]));
  const [okLine, refusedLine] = [linesOf(ok)[0], linesOf(refused)[0]];
  expect([field(okLine, 'outcome'), field(refusedLine, 'outcome')]).toEqual(['ok', 'error']);
  expect(field(okLine, 'rid')).not.toBe(field(refusedLine, 'rid'));
});

test('a line written during a request carries its rid, as its access line does', async () => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST', body: '{not json', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.21' },
  });
  expect(res.status).toBe(400);
  const access = await vi.waitFor(() => {
    const line = lines().find((l) => l.includes(' ip=203.0.113.21 '));
    expect(line).toBeDefined();
    return line!;
  });
  expect(field(access, 'status')).toBe('400');
  expect(lines()).toContain(`level=warn msg="HTTP error" error="Invalid JSON body" rid=${field(access, 'rid')}`);
});

test('/health: the platform\'s own probe (an internal address) is not logged, an external monitor is', async () => {
  const healthLines = () => lines().filter((l) => l.includes(' path=/health '));
  const before = healthLines().length;
  expect((await fetch(`${base}/health`)).status).toBe(200);
  expect((await fetch(`${base}/health`, { headers: { 'X-Forwarded-For': '203.0.113.22' } })).status).toBe(200);
  await vi.waitFor(() => expect(healthLines().length).toBe(before + 1));
  expect(field(healthLines().at(-1), 'ip')).toBe('203.0.113.22');
});

test('the X-Request-Id header is the access line\'s rid', async () => {
  const res = await fetch(`${base}/health`, { headers: { 'X-Forwarded-For': '203.0.113.23' } });
  const rid = res.headers.get('x-request-id');
  expect(rid).toMatch(/^[0-9a-f]{16}$/);
  await vi.waitFor(() => expect(field(lineFrom('203.0.113.23'), 'rid')).toBe(rid));
});

test('an MCP POST refused without a method (malformed body, bad Origin) is outcome=error; a GET 405 is not', async () => {
  const post = (ip: string, body: string, headers: Record<string, string> = {}) => fetch(`${base}/mcp`, {
    method: 'POST', body, headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'X-Forwarded-For': ip, ...headers },
  });
  const refused = [
    ['203.0.113.40', 'null'], ['203.0.113.41', '5'], ['203.0.113.42', '"x"'], ['203.0.113.43', '{}'],
    ['203.0.113.44', '{"jsonrpc":"2.0","id":1,"method":7}'], ['203.0.113.45', '{not json'],
  ];
  for (const [ip, body] of refused) expect((await post(ip, body)).status).toBeGreaterThanOrEqual(400);
  expect((await post('203.0.113.46', '{"jsonrpc":"2.0","id":1,"method":"tools/list"}', { Origin: 'https://evil.example.test' })).status).toBe(403);
  expect((await fetch(`${base}/mcp`, { headers: { 'X-Forwarded-For': '203.0.113.47' } })).status).toBe(405);
  for (const ip of [...refused.map(([ip]) => ip), '203.0.113.46']) {
    const line = await vi.waitFor(() => {
      expect(lineFrom(ip)).toBeDefined();
      return lineFrom(ip)!;
    });
    expect(line).toMatch(/^level=warn /);
    expect(field(line, 'outcome')).toBe('error');
  }
  await vi.waitFor(() => expect(lineFrom('203.0.113.47')).toMatch(/^level=info /));
  expect(field(lineFrom('203.0.113.47'), 'outcome')).toBeUndefined();
});

test('a client leaving mid-body: an info line, no error, and no answer attempted', async () => {
  const socket = tcpConnect((server.address() as AddressInfo).port, '127.0.0.1');
  await new Promise((resolve) => socket.once('connect', resolve));
  socket.write('POST /mcp HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n' +
    'X-Forwarded-For: 203.0.113.50\r\n\r\n{"jsonrpc":"2.0",');
  await new Promise((resolve) => setTimeout(resolve, 100));
  socket.destroy();
  const access = await vi.waitFor(() => {
    expect(lineFrom('203.0.113.50')).toBeDefined();
    return lineFrom('203.0.113.50')!;
  });
  expect(access).toMatch(/^level=info .* aborted=1 rid=/);
  const rid = field(access, 'rid');
  await vi.waitFor(() => expect(lines()).toContain(`level=info msg="HTTP error" error=aborted rid=${rid}`));
  expect(lines().filter((line) => line.endsWith(` rid=${rid}`))).toHaveLength(2);
});
