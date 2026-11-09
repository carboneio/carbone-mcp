import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { CarboneClient } from '../../src/carbone/client.js';
import { registerTools } from '../../src/tools/index.js';
import { registerResources } from '../../src/resources/index.js';
import { STDIO_IO } from '../../src/tools/inputForms.js';
import { DISABLEABLE_TOOLS, TOOL_NAMES, NO_TOOLS, type ToolName } from '../../src/tools/toolNames.js';
import { serverInfo, serverOptionsFor } from '../../src/server/serverInfo.js';
import { startHttpServer } from '../../src/server/http.js';

/**
 * MCP_DISABLED_TOOLS, for each tool on stdio and on HTTP with upload URLs and async renders: the tool and its resources
 * are not registered, and its name vanishes from tools/list, resources/list, the instructions and get_capabilities,
 * while every other tool these texts named is still named. Tool results and errors are not covered.
 */

const named = (text: string) => TOOL_NAMES.filter((tool) => new RegExp(`\\b${tool}\\b`).test(text));
const RESOURCES_OF: Partial<Record<ToolName, string[]>> = {
  list_templates: ['carbone-templates', 'carbone-template'], list_categories: ['carbone-categories'],
  list_tags: ['carbone-tags'], get_api_status: ['carbone-status'],
};
/** Async renders need both of their tools. */
const goneWith = (tool: ToolName): string[] => (tool === 'render_document' ? [tool, 'get_render_result'] : [tool]);

interface Surface { tools: string[]; resources: string[]; texts: Record<string, string>; routes?: { upload: number; webhook: number } }

async function surfaceOf(client: Client): Promise<Surface> {
  const { tools } = await client.listTools();
  const { resources } = await client.listResources();
  const { resourceTemplates } = await client.listResourceTemplates();
  const texts: Record<string, string> = {
    instructions: client.getInstructions() ?? '', resources: JSON.stringify([resources, resourceTemplates]),
  };
  const result = await client.callTool({ name: 'get_capabilities', arguments: {} });
  texts['get_capabilities'] = (result.content as Array<{ text: string }>)[0]!.text;
  for (const t of tools) texts[`${t.name} listing`] = JSON.stringify(t);
  return { tools: tools.map((t) => t.name), resources: [...resources, ...resourceTemplates].map((r) => r.name), texts };
}

/** stdio, set up as src/index.ts does. */
async function stdioClient(disabled: ReadonlySet<ToolName>, carbone = new CarboneClient({ apiKey: 'unused' })): Promise<Client> {
  const server = new McpServer(serverInfo('0.0.0-test'), serverOptionsFor(STDIO_IO, disabled));
  registerTools(server, carbone, { allowFileOutput: true, allowFileInput: true, allowPrivateNetwork: false, maxFileBytes: 1024 }, disabled);
  registerResources(server, carbone, disabled);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'disabled-tools-test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function stdioSurface(disabled: ReadonlySet<ToolName>): Promise<Surface> {
  const client = await stdioClient(disabled);
  try { return await surfaceOf(client); } finally { await client.close(); }
}

let jobsDir: string;
beforeAll(() => { jobsDir = mkdtempSync(join(tmpdir(), 'carbone-mcp-jobs-')); });
afterAll(() => rmSync(jobsDir, { recursive: true, force: true }));

/** HTTP with upload URLs and async renders configured, through startHttpServer. */
async function httpSurface(disabledTools: ReadonlySet<ToolName>): Promise<Surface> {
  const listenersBefore: unknown[] = [...process.listeners('SIGTERM'), ...process.listeners('SIGINT')];
  const httpServer = await startHttpServer({
    client: new CarboneClient({ baseUrl: 'http://127.0.0.1:9', transport: 'http' }),
    version: '0.0.0-test', port: 0, mcpPath: '/mcp', maxBodyBytes: 1024 * 1024, maxFileBytes: 1024 * 1024,
    allowPrivateNetwork: false, allowedOriginHostnames: [], disabledTools,
    tickets: { secret: Buffer.alloc(32, 7), publicUrl: 'https://mcp.example.test' }, jobStore: { dir: jobsDir },
  });
  const base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const client = new Client({ name: 'disabled-tools-test', version: '0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: 'Bearer k' } } }));
    const post = async (path: string) => (await fetch(`${base}${path}`, { method: 'POST', body: '{}' })).status;
    return { ...await surfaceOf(client), routes: { upload: await post('/upload'), webhook: await post('/webhook') } };
  } finally {
    await client.close();
    for (const s of ['SIGTERM', 'SIGINT'] as const) {
      for (const l of process.listeners(s)) if (!listenersBefore.includes(l)) process.removeListener(s, l);
    }
    httpServer.closeAllConnections();
    await new Promise((resolve) => httpServer.close(resolve));
  }
}

describe.each([
  ['stdio', stdioSurface, TOOL_NAMES.filter((t) => t !== 'get_render_result')],
  ['HTTP with upload URLs and async renders', httpSurface, [...TOOL_NAMES]],
] as const)('%s', (_mode, surface, expectedTools) => {
  let all: Surface;
  beforeAll(async () => { all = await surface(NO_TOOLS); });

  test('without MCP_DISABLED_TOOLS: every tool and resource', () => {
    expect([...all.tools].sort()).toEqual([...expectedTools].sort());
    expect([...all.resources].sort()).toEqual(Object.values(RESOURCES_OF).flat().sort());
  });

  test.each(DISABLEABLE_TOOLS)('%s disabled: not registered, named nowhere, no other tool name lost', async (tool) => {
    const left = await surface(new Set([tool]));
    const gone = goneWith(tool);
    expect(left.tools).toEqual(all.tools.filter((t) => !gone.includes(t)));
    expect(left.resources).toEqual(all.resources.filter((r) => !RESOURCES_OF[tool]?.includes(r)));
    for (const [where, text] of Object.entries(left.texts)) {
      expect(named(text), where).not.toContain(tool);
      if (all.texts[where]) expect(named(text), where).toEqual(named(all.texts[where]).filter((t) => !gone.includes(t)));
    }
    if (!left.routes) return;
    // Upload URLs need upload_template; async renders, render_document and get_render_result.
    const asyncOn = !['render_document', 'get_render_result'].includes(tool);
    expect(left.routes.upload === 404).toBe(tool === 'upload_template');
    expect(left.routes.webhook === 404).toBe(!asyncOn);
    if (tool !== 'render_document') expect(left.texts['render_document listing']!.includes('"async"')).toBe(asyncOn);
  });
});

test('a call to a disabled tool gets the SDK unknown-tool error, and its handler never runs', async () => {
  const carbone = { deleteTemplate: vi.fn(), getTags: vi.fn(async () => ['a']) } as unknown as CarboneClient;
  const client = await stdioClient(new Set(['delete_template', 'upload_template', 'update_template_metadata']), carbone);
  try {
    await expect(client.callTool({ name: 'delete_template', arguments: { templateId: '1530905183164918624' } }))
      .rejects.toThrow(/Tool delete_template not found/);
    expect(carbone.deleteTemplate).not.toHaveBeenCalled();
    expect((await client.callTool({ name: 'list_tags', arguments: {} })).structuredContent).toEqual({ tags: ['a'] });
  } finally {
    await client.close();
  }
});
