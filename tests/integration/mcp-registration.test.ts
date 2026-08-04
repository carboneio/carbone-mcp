import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
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
    expect(convert?.annotations?.readOnlyHint).toBe(true);

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
