import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { CarboneClient } from '../../src/carbone/client.js';
import { startHttpServer } from '../../src/server/http.js';

/**
 * Upload URLs end to end: upload_template with requestUploadUrl over MCP, then the file sent to /upload, streamed by
 * the real Carbone client to a mock Carbone that parses the multipart it receives.
 */

const FILE = Buffer.from('PK\u0003\u0004 the template bytes, long enough to be streamed');
const SHA = createHash('sha256').update(FILE).digest('hex');

type Received = { auth?: string; fields: Array<[string, string]>; file: Buffer };
let received: Received[] = [];
let aborted = 0;
let mock: Server;
let mockUrl: string;
let httpServer: Server;
let base: string;
const signals = ['SIGTERM', 'SIGINT'] as const;
let listenersBefore: unknown[][] = [];

/** Minimal multipart/form-data parser: the parts in order, as [name, value] and the file. */
function parseMultipart(body: Buffer, boundary: string): { fields: Array<[string, string]>; file: Buffer } {
  const fields: Array<[string, string]> = [];
  let file = Buffer.alloc(0);
  const delimiter = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delimiter) + delimiter.length;
  for (;;) {
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    const part = body.subarray(start + 2, next - 2); // drop the CRLF after the delimiter and before the next one
    const split = part.indexOf('\r\n\r\n');
    const headers = part.subarray(0, split).toString();
    const value = part.subarray(split + 4);
    const name = /name="([^"]+)"/.exec(headers)![1]!;
    if (name === 'template') file = Buffer.from(value);
    else fields.push([name, value.toString()]);
    start = next + delimiter.length;
  }
  return { fields, file };
}

beforeAll(async () => {
  mock = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('aborted', () => { aborted++; });
    req.on('end', () => {
      const boundary = /boundary=(.+)$/.exec(req.headers['content-type'] ?? '')![1]!;
      const parsed = parseMultipart(Buffer.concat(chunks), boundary);
      received.push({ auth: req.headers.authorization, ...parsed });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { id: '1530905183164918624', versionId: 'ab'.repeat(32), type: 'docx', size: parsed.file.length, deployedAt: 0 } }));
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  mockUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

  listenersBefore = signals.map((s) => process.listeners(s));
  httpServer = await startHttpServer({
    client: new CarboneClient({ baseUrl: mockUrl, transport: 'http' }),
    version: '0.0.0-test', port: 0, mcpPath: '/mcp', maxBodyBytes: 1024 * 1024, maxFileBytes: 1024 * 1024,
    allowPrivateNetwork: false, allowedOriginHostnames: [],
    tickets: { secret: Buffer.alloc(32, 5), publicUrl: 'https://mcp.example.test' },
  });
  base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const [i, s] of signals.entries()) {
    for (const l of process.listeners(s)) if (!listenersBefore[i].includes(l)) process.removeListener(s, l);
  }
  httpServer.closeAllConnections();
  await new Promise((resolve) => httpServer.close(resolve));
  mock.closeAllConnections();
  await new Promise((resolve) => mock.close(resolve));
});

beforeEach(() => {
  received = [];
  aborted = 0;
});

async function connect(): Promise<Client> {
  const client = new Client({ name: 'upload-url-test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: 'Bearer caller-key' } },
  }));
  return client;
}

/** upload_template in requestUploadUrl mode; the URL it returns, pointed at the test server. */
async function requestUpload(args: Record<string, unknown>) {
  const client = await connect();
  try {
    const result = await client.callTool({ name: 'upload_template', arguments: { requestUploadUrl: { size: FILE.length, sha256: SHA }, ...args } });
    const issued = result.structuredContent as { uploadUrl: string; headers: Record<string, string> } | undefined;
    return { result, url: issued && `${base}${new URL(issued.uploadUrl).pathname}`, headers: issued?.headers };
  } finally {
    await client.close();
  }
}

describe('upload URLs end to end', () => {
  test('tools/list offers requestUploadUrl on upload_template', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    await client.close();
    const schema = tools.find((t) => t.name === 'upload_template')!.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty('requestUploadUrl');
  });

  test('the tool returns the URL and command; sending the file stores the template with the caller key', async () => {
    const { result, url, headers } = await requestUpload({ name: 'Invoice', category: 'billing', tags: ['b', 'a'] });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toMatch(/^NOT uploaded yet/);
    expect(text).toContain(`curl -sS -H 'X-Upload-Token: ${headers!['X-Upload-Token']}' --data-binary @<file>`);
    expect(text).toContain('@<file> https://mcp.example.test/upload');
    expect(result.structuredContent).toEqual({ uploadUrl: 'https://mcp.example.test/upload', headers, expiresAt: expect.any(Number) });
    expect(received).toEqual([]); // nothing stored by the tool call itself

    const res = await fetch(url!, { method: 'POST', headers, body: FILE });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: '1530905183164918624', name: 'Invoice', message: expect.stringMatching(/^Template uploaded successfully!/) });
    expect(received).toEqual([{
      auth: 'Bearer caller-key',
      fields: [['versioning', 'true'], ['name', 'Invoice'], ['category', 'billing'], ['tags', '["b","a"]']],
      file: FILE,
    }]);
  });

  test('without versioning, the ticket nonce is the salt, and a replay sends the same one', async () => {
    const { url, headers } = await requestUpload({ versioning: false, expireAt: 1900000000 });
    expect((await fetch(url!, { method: 'POST', headers, body: FILE })).status).toBe(200);
    expect((await fetch(url!, { method: 'POST', headers, body: FILE })).status).toBe(200);
    const [first, replay] = received;
    expect(first!.fields).toEqual([['salt', expect.stringMatching(/^[0-9a-f]{32}$/)], ['expireAt', '1900000000']]);
    expect(replay!.fields).toEqual(first!.fields);
  });

  test('a different file of the same size is cut off before the last boundary: Carbone never gets a whole upload', async () => {
    const { url, headers } = await requestUpload({});
    const other = Buffer.from(FILE);
    other[other.length - 1] = 0;
    const res = await fetch(url!, { method: 'POST', headers, body: other });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/does not have the SHA-256.*nothing was stored/);
    await expect.poll(() => aborted).toBe(1);
    expect(received).toEqual([]);
  });

  test('requestUploadUrl with template or sample is refused by the tool', async () => {
    const both = await requestUpload({ template: 'aGVsbG8=' });
    expect(both.result.isError).toBe(true);
    const client = await connect();
    const withSample = await client.callTool({ name: 'upload_template', arguments: { requestUploadUrl: { size: 1, sha256: SHA }, sample: [{ data: {} }] } });
    await client.close();
    expect((withSample.content as Array<{ text: string }>)[0]!.text).toMatch(/sample cannot be sent with requestUploadUrl/);
  });
});
