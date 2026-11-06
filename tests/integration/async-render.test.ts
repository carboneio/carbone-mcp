import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { CarboneClient } from '../../src/carbone/client.js';
import { startHttpServer } from '../../src/server/http.js';

/**
 * Async renders end to end: render_document with async: true over MCP, a mock Carbone that answers at once and then
 * calls this server's webhook the way Carbone does (one POST, the carbone-webhook-header-* headers forwarded), a
 * fake S3 for the results, and get_render_result read through MCP.
 */

let carbone: Server;
let s3: Server;
let httpServer: Server;
let base: string;
const objects = new Map<string, string>();
const renders: Array<{ headers: Record<string, unknown>; body: Record<string, unknown> }> = [];
const signals = ['SIGTERM', 'SIGINT'] as const;
let listenersBefore: unknown[][] = [];

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

beforeAll(async () => {
  s3 = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'PUT') objects.set(req.url!, Buffer.concat(chunks).toString());
      const object = objects.get(req.url!);
      if (req.method === 'GET' && object === undefined) return res.writeHead(404).end();
      res.writeHead(200).end(req.method === 'GET' ? object : undefined);
    });
  });
  carbone = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      renders.push({ headers: req.headers, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'A render ID will be sent to your callback URL when the document is generated', data: { renderId: '' } }));
      // Then, as Carbone does once the document is ready: one POST to the webhook, custom headers forwarded.
      const forwarded = Object.fromEntries(Object.entries(req.headers)
        .filter(([name]) => name.startsWith('carbone-webhook-header-'))
        .map(([name, value]) => [name.slice('carbone-webhook-header-'.length), String(value)]));
      const webhook = new URL(String(req.headers['carbone-webhook-url']));
      const result = body['data'] && (body['data'] as Record<string, unknown>)['fail']
        ? { success: false, error: 'Template error at line 3' }
        : { success: true, data: { renderId: 'r-async.pdf' } };
      setTimeout(() => void fetch(`${base}${webhook.pathname}`, {
        method: 'POST', headers: { ...forwarded, 'Content-Type': 'application/json' }, body: JSON.stringify(result),
      }), 30);
    });
  });
  const carboneUrl = await listen(carbone);
  const s3Url = await listen(s3);

  listenersBefore = signals.map((s) => process.listeners(s));
  httpServer = await startHttpServer({
    client: new CarboneClient({ baseUrl: carboneUrl, transport: 'http' }),
    version: '0.0.0-test', port: 0, mcpPath: '/mcp', maxBodyBytes: 1024 * 1024, maxFileBytes: 1024 * 1024,
    allowPrivateNetwork: false, allowedOriginHostnames: [],
    tickets: { secret: Buffer.alloc(32, 6), publicUrl: 'https://mcp.example.test' },
    jobStore: { endpoint: s3Url, region: 'eu-west-1', bucket: 'jobs', accessKeyId: 'AK', secretAccessKey: 'SK' },
  });
  base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const [i, s] of signals.entries()) {
    for (const l of process.listeners(s)) if (!listenersBefore[i].includes(l)) process.removeListener(s, l);
  }
  for (const server of [httpServer, carbone, s3]) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: 'async-render-test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: 'Bearer caller-key' } },
  }));
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

const textOf = (result: { content: unknown }) => (result.content as Array<{ text: string }>)[0]!.text;

/** render_document with async: true; the job ID it returns. */
async function startJob(client: Client, args: Record<string, unknown>): Promise<string> {
  const started = await client.callTool({ name: 'render_document', arguments: { template: 'aGVsbG8=', convertTo: 'pdf', async: true, ...args } });
  expect(started.isError).toBeFalsy();
  return /Job ID:\n(\S+)/.exec(textOf(started))![1]!;
}

describe('async renders end to end', () => {
  test('tools/list offers async on render_document, and get_render_result', async () => {
    const { tools } = await withClient((client) => client.listTools());
    const render = tools.find((t) => t.name === 'render_document')!.inputSchema as { properties: Record<string, { description?: string }> };
    expect(render.properties).toHaveProperty('async');
    expect(render.properties['batchSplitBy']!.description).toMatch(/Needs async: true \(or a webhookUrl the user provides\)/);
    expect(tools.find((t) => t.name === 'get_render_result')?.annotations?.readOnlyHint).toBe(true);
  });

  test('a job: Carbone gets this server webhook and a sealed header, the assistant gets the link once ready', async () => {
    const text = await withClient(async (client) => {
      const jobId = await startJob(client, {});
      let result = '';
      await expect.poll(async () => (result = textOf(await client.callTool({ name: 'get_render_result', arguments: { jobId } }))))
        .toMatch(/One-time download link/);
      return result;
    });
    expect(text).toContain('/render/r-async.pdf?download=true');
    const { headers } = renders.at(-1)!;
    expect(headers['carbone-webhook-url']).toBe('https://mcp.example.test/webhook');
    expect(headers['carbone-webhook-header-x-job-token']).toMatch(/^v1\./);
    expect([...objects.keys()].every((key) => /^\/jobs\/jobs\/[0-9a-f]{64}$/.test(key))).toBe(true);
  });

  test('a batch needs no webhookUrl of its own with async', async () => {
    await withClient((client) => startJob(client, { data: [{ a: 1 }, { a: 2 }], batchSplitBy: 'd', batchOutput: 'zip' }));
    expect(renders.at(-1)!.body).toMatchObject({ batchSplitBy: 'd', batchOutput: 'zip' });
  });

  test('a failed render is reported with Carbone error; an unknown job ID is refused', async () => {
    const [failed, unknown] = await withClient(async (client) => {
      const jobId = await startJob(client, { data: { fail: true } });
      let result = { isError: false, content: [] as unknown };
      await expect.poll(async () => (result = await client.callTool({ name: 'get_render_result', arguments: { jobId } }) as typeof result).isError).toBe(true);
      return [textOf(result), textOf(await client.callTool({ name: 'get_render_result', arguments: { jobId: 'v1.forged' } }))];
    });
    expect(failed).toBe('The render failed: Template error at line 3');
    expect(unknown).toMatch(/^Unknown or expired job ID/);
  });

  test('async and webhookUrl together are refused', async () => {
    const result = await withClient((client) => client.callTool({
      name: 'render_document', arguments: { template: 'aGVsbG8=', async: true, webhookUrl: 'https://example.test/hook' },
    }));
    expect(textOf(result)).toMatch(/pass async or webhookUrl, not both/);
  });

  test('the webhook refuses a call without a valid job token, and any method but POST', async () => {
    const forged = await fetch(`${base}/webhook`, { method: 'POST', headers: { 'x-job-token': 'v1.nope', 'Content-Type': 'application/json' }, body: '{}' });
    expect(forged.status).toBe(401);
    expect((await fetch(`${base}/webhook`)).status).toBe(405);
  });
});
