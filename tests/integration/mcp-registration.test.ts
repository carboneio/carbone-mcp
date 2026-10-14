import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/client';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { CarboneClient } from '../../src/carbone/client.js';
import { registerTools } from '../../src/tools/index.js';
import { registerResources } from '../../src/resources/index.js';
import { serverInfo, SERVER_OPTIONS } from '../../src/server/serverInfo.js';
import { OUTPUT_FORMATS } from '../../src/validation/formats.js';

/**
 * In-process protocol test: a real MCP Client talks to our McpServer over a linked in-memory
 * transport. This asserts the *registered surface* (identity, capabilities, tools, resources) the
 * way a client sees it — coverage that the handler unit tests (which bypass registration) miss.
 * No API key or network needed, so it runs in CI. Promoted from the battle test's registration checks.
 */
describe('MCP registration surface (in-process, no API key)', () => {
  let client: Client;

  beforeAll(async () => {
    const server = new McpServer(serverInfo('0.0.0-test'), SERVER_OPTIONS);
    // The Carbone client is never called by registration / get_capabilities, so a dummy key is fine.
    const carbone = new CarboneClient({ apiKey: 'unused', baseUrl: CarboneClient.CLOUD_API_URL });
    registerTools(server, carbone, {
      allowFileOutput: true,
      allowFileInput: true,
      allowPrivateNetwork: false,
      maxFileBytes: 100 * 1024 * 1024,
    });
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
    // The tool and resource lists are static, so list changes are not advertised (SERVER_OPTIONS).
    expect(caps?.tools).toEqual({ listChanged: false });
    expect(caps?.resources).toEqual({ listChanged: false });
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

  test('convert_document / render_document advertise the OpenAPI-synced enums and limits', async () => {
    type Prop = { type?: string; enum?: unknown[]; maxLength?: number; anyOf?: Prop[]; items?: Prop };
    const { tools } = await client.listTools();
    const props = (name: string) => tools.find((t) => t.name === name)!.inputSchema.properties as Record<string, Prop>;
    const convert = props('convert_document');
    const render = props('render_document');

    for (const p of [convert, render]) {
      expect(p['converter']?.enum).toEqual(['L', 'O', 'C', 'I']);
      expect(p['egressAuthorization']?.maxLength).toBe(511);
      expect(p['convertTo']?.anyOf?.[0]?.enum).toEqual([...OUTPUT_FORMATS]);
      expect(p['convertTo']?.anyOf?.[0]?.enum).toHaveLength(36);
    }
    expect(convert).not.toHaveProperty('data'); // pure conversion: no data input
    expect(convert['hardRefresh']?.type).toBe('boolean');
    expect(render['batchOutput']?.enum).toEqual(['zip', 'pdf']);
    expect(render['failOn']?.items?.enum).toEqual(['IMAGE_URL_ERROR']);
    expect(render['preReleaseFeatureIn']?.type).toBe('integer');
    // 1.6.0 parameters kept on the v2 surface.
    expect(render['keepTags']?.type).toBe('boolean');
    expect(convert['reportName']?.type).toBe('string');
    expect(props('download_template')['sample']?.type).toBe('boolean');
  });

  test('no tool presents 42000000000 as an expireAt value (that NOW sentinel exists only for deployedAt)', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const props = (tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
      expect(props['expireAt']?.description ?? '', tool.name).not.toContain('42000000000');
      for (const text of [tool.description ?? '', ...Object.values(props).map((p) => p.description ?? '')]) {
        expect(text, tool.name).not.toMatch(/expireAt[^.]*42000000000/);
      }
    }
  });

  test('upload_template / update_template_metadata advertise the OpenAPI-synced schemas', async () => {
    type Prop = { maxItems?: number; maxLength?: number; minimum?: number; items?: { additionalProperties?: unknown; required?: string[] } };
    type Schema = { properties?: Record<string, Prop>; required?: string[] };
    const { tools } = await client.listTools();
    const upload = tools.find((t) => t.name === 'upload_template')!;
    const update = tools.find((t) => t.name === 'update_template_metadata')!;
    const up = upload.inputSchema as Schema;
    const upd = update.inputSchema as Schema;

    expect(up.required).toEqual(['template']);
    expect(up.properties?.['sample']).toMatchObject({ maxItems: 1, items: { additionalProperties: false } });
    expect(up.properties?.['sample']?.items?.required).toBeUndefined();
    for (const p of [up, upd]) {
      for (const field of ['name', 'comment', 'category']) expect(p.properties?.[field]?.maxLength, field).toBe(200);
      expect(p.properties?.['expireAt']?.minimum).toBe(0);
    }
    expect(upd.properties).toHaveProperty('moveToTemplateId');
    // The API body field `id` is documented as moveToTemplateId; `id` stays only as the deprecated 1.6.0 alias.
    expect((upd.properties?.['id'] as { description?: string } | undefined)?.description).toMatch(/^DEPRECATED: the 1\.6\.0 name of moveToTemplateId/);
    expect((update.outputSchema as Schema | undefined)?.required).toEqual(['versionId']);
    expect((upload.outputSchema as Schema | undefined)?.properties).toHaveProperty('deployedAt');
    expect((upload.outputSchema as Schema | undefined)?.properties).toHaveProperty('templateExtension');
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

/**
 * Tool calls through a real MCP client, so the SDK validates each structuredContent against the registered
 * outputSchema (handler unit tests bypass that check). The Carbone client is a stub returning response shapes
 * recorded from api.carbone.io.
 */
describe('structured output passes SDK output-schema validation (live API response shapes)', () => {
  let client: Client;
  const carbone = {
    isCloud: true,
    assertCanAuthenticate: () => {},
    // PATCH name + category + tags: the API echoes "deployedAt": null although it was not sent.
    updateTemplate: async () => ({
      name: 'BattleTest updated', category: 'bt-cat2', tags: ['bt', 'upd'], deployedAt: null, versionId: '4dc8abc',
    }),
    // POST /template with versioning.
    uploadTemplate: async () => ({
      id: '1530905183164918624', versionId: '929a', templateId: '929a', type: 'html',
      createdAt: 1791957319, deployedAt: 0, size: 46, templateExtension: 'html',
    }),
  } as unknown as CarboneClient;

  beforeAll(async () => {
    const server = new McpServer(serverInfo('0.0.0-test'), SERVER_OPTIONS);
    registerTools(server, carbone, {
      allowFileOutput: false, allowFileInput: false, allowPrivateNetwork: false, maxFileBytes: 1024,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'output-schema-test', version: '0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
  });

  test('tools/list over HTTP offers no local path and marks outputPath unavailable', async () => {
    const { tools } = await client.listTools();
    for (const name of ['convert_document', 'render_document', 'download_template']) {
      const tool = tools.find((t) => t.name === name)!;
      const props = tool.inputSchema.properties as Record<string, { description?: string }>;
      expect(props['outputPath']?.description, name).toMatch(/^NOT AVAILABLE/);
    }
    const convert = tools.find((t) => t.name === 'convert_document')!;
    expect(convert.description).toMatch(/local file paths are not accepted over HTTP/);
    expect((convert.inputSchema.properties as Record<string, { description?: string }>)['file']?.description)
      .not.toMatch(/Local file path —/);
  });

  test('update_template_metadata: "deployedAt": null in the API response is not an error', async () => {
    const result = await client.callTool({
      name: 'update_template_metadata',
      arguments: { templateId: '1530905183164918624', name: 'BattleTest updated', category: 'bt-cat2', tags: ['bt', 'upd'] },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      versionId: '4dc8abc', name: 'BattleTest updated', category: 'bt-cat2', tags: ['bt', 'upd'],
    });
  });

  test('upload_template: the live versioned response passes', async () => {
    const result = await client.callTool({ name: 'upload_template', arguments: { template: 'aGVsbG8=', name: 'Invoice' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      name: 'Invoice', id: '1530905183164918624', versionId: '929a', type: 'html', size: 46, createdAt: 1791957319, deployedAt: 0,
    });
  });
});

/** Connect an in-process MCP client to a server registered with the given file context. */
async function connect(carbone: CarboneClient, fileCtx: Parameters<typeof registerTools>[2]): Promise<Client> {
  const server = new McpServer(serverInfo('0.0.0-test'), SERVER_OPTIONS);
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
