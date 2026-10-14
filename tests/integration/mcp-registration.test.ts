import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CarboneClient } from '../../src/carbone/client.js';
import { registerTools } from '../../src/tools/index.js';
import { registerResources } from '../../src/resources/index.js';
import { serverInfo, SERVER_INSTRUCTIONS } from '../../src/server/serverInfo.js';

/**
 * In-process protocol test: a real MCP Client talks to our McpServer over a linked in-memory
 * transport. This asserts the *registered surface* (identity, capabilities, tools, resources) the
 * way a client sees it — coverage that the handler unit tests (which bypass registration) miss.
 * No API key or network needed, so it runs in CI. Promoted from the battle test's registration checks.
 */
describe('MCP registration surface (in-process, no API key)', () => {
  let client: Client;

  beforeAll(async () => {
    const server = new McpServer(serverInfo('0.0.0-test'), { instructions: SERVER_INSTRUCTIONS });
    // The Carbone client is never called by registration / get_capabilities, so a dummy key is fine.
    const carbone = new CarboneClient({ apiKey: 'unused', baseUrl: CarboneClient.CLOUD_API_URL });
    registerTools(server, carbone, { allowFileOutput: true, maxFileBytes: 100 * 1024 * 1024 });
    registerResources(server, carbone);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'registration-test', version: '0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
  });

  test('initialize advertises identity, two icons, capabilities, and instructions', () => {
    const info = client.getServerVersion();
    expect(info?.name).toBe('carbone-mcp');
    expect(info?.title).toBe('Carbone');
    expect(info?.icons?.length).toBe(2);

    const caps = client.getServerCapabilities();
    expect(caps?.tools).toBeTruthy();
    expect(caps?.resources).toBeTruthy();
    expect(caps?.completions).toBeTruthy();

    expect(client.getInstructions()).toContain('get_capabilities');
  });

  test('tools/list exposes all 11 tools with titles, annotations, and outputSchema', async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(11);

    const convert = tools.find((t) => t.name === 'convert_document');
    expect(convert?.title).toBe('Convert Document');
    // stdio: the document tools may write a local file (outputPath / temp file), so they are not read-only.
    expect(convert?.annotations?.readOnlyHint).toBe(false);

    expect(tools.find((t) => t.name === 'delete_template')?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'list_templates')?.outputSchema).toBeTruthy();
  });

  test('resources/list and resource templates expose the registered URIs', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      'carbone://categories',
      'carbone://status',
      'carbone://tags',
      'carbone://templates',
    ]);

    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.some((r) => r.uriTemplate === 'carbone://templates/{id}')).toBe(true);
  });

  test('get_capabilities returns the overview without any API call', async () => {
    const r = await client.callTool({ name: 'get_capabilities', arguments: {} });
    const text = (r.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Carbone');
    expect(text).toContain('convert_document');
    expect(text).toContain('carbone://templates/{id}');
  });
});

/** Connect an in-process MCP client to a server registered with the given file context. */
async function connect(carbone: CarboneClient, fileCtx: Parameters<typeof registerTools>[2]): Promise<Client> {
  const server = new McpServer(serverInfo('0.0.0-test'), { instructions: SERVER_INSTRUCTIONS });
  registerTools(server, carbone, fileCtx);
  registerResources(server, carbone);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'registration-test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const STDIO_CTX = { allowFileOutput: true, allowFileInput: true, allowPrivateNetwork: false, maxFileBytes: 1024 * 1024 };
const HTTP_CTX = { allowFileOutput: false, allowFileInput: false, allowPrivateNetwork: false, maxFileBytes: 1024 * 1024 };
const DOCUMENT_TOOLS = ['render_document', 'convert_document', 'download_template'];

describe('tool annotations follow the transport', () => {
  test.each([
    ['stdio', STDIO_CTX, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }],
    ['HTTP', HTTP_CTX, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }],
  ])('%s: render/convert/download_template hints', async (_name, ctx, expected) => {
    const client = await connect(new CarboneClient({ apiKey: 'unused' }), ctx);
    const { tools } = await client.listTools();
    for (const name of DOCUMENT_TOOLS) {
      expect(tools.find((t) => t.name === name)?.annotations, name).toEqual(expected);
    }
    await client.close();
  });
});

describe('HTTP mode: no URL is fetched for a caller without credentials', () => {
  let listener: Server;
  let port = 0;
  let hits = 0;

  beforeAll(async () => {
    listener = createServer((_req, res) => { hits++; res.end('{"a":1}'); });
    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
    port = (listener.address() as AddressInfo).port;
  });

  afterAll(() => new Promise<void>((resolve) => listener.close(() => resolve())));

  test('render, convert and upload refuse before downloading anything', async () => {
    // Cloud API, no server key, no Bearer token. allowPrivateNetwork is ON so that, without the
    // auth-first check, the loopback URL WOULD be fetched — the zero-hit count is the proof.
    const carbone = new CarboneClient({ transport: 'http', baseUrl: CarboneClient.CLOUD_API_URL });
    const client = await connect(carbone, { ...HTTP_CTX, allowPrivateNetwork: true });
    const url = `http://127.0.0.1:${port}/input`;
    const calls = [
      { name: 'render_document', arguments: { template: url, data: url, complement: url } },
      { name: 'convert_document', arguments: { file: url, convertTo: 'pdf' } },
      { name: 'upload_template', arguments: { template: url, name: 'x' } },
    ];
    for (const call of calls) {
      const r = await client.callTool(call);
      expect(r.isError, call.name).toBe(true);
      expect((r.content as Array<{ text: string }>)[0]!.text, call.name).toContain('No API key provided');
    }
    expect(hits).toBe(0);
    await client.close();
  });
});
