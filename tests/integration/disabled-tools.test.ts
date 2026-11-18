import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { CarboneClient } from '../../src/carbone/client.js';
import { CarboneNotFoundError } from '../../src/carbone/errors.js';
import { registerTools } from '../../src/tools/index.js';
import { registerResources } from '../../src/resources/index.js';
import { STDIO_IO } from '../../src/tools/inputForms.js';
import { DISABLEABLE_TOOLS, TOOL_ALIASES, TOOL_NAMES, NO_TOOLS, withoutTools, type ToolName } from '../../src/tools/toolNames.js';
import { serverInfo, serverOptionsFor } from '../../src/server/serverInfo.js';
import { startHttpServer } from '../../src/server/http.js';
import { loadServedSkills, servesCarboneSkill } from '../../src/server/skills.js';

/**
 * A tool MCP_ENABLED_TOOLS leaves out, for each tool on stdio and on HTTP with upload URLs and async renders: the tool and its resources
 * are not registered, and its name vanishes from tools/list, resources/list, the instructions and get_capabilities,
 * while every other tool these texts named is still named. Tool results and errors are not covered.
 */

const named = (text: string) => TOOL_NAMES.filter((tool) => new RegExp(`\\b${tool}\\b`).test(text));
const RESOURCES_OF: Partial<Record<ToolName, string[]>> = {
  list_templates: ['carbone-templates', 'carbone-template'], list_categories: ['carbone-categories'],
  list_tags: ['carbone-tags'], get_api_status: ['carbone-status'],
};
/** The served Carbone Skill and the skills index: tied to no tool, so always listed. */
const SKILL_RESOURCES = ['carbone', 'io.modelcontextprotocol/skills'];
/** Async renders need both of their tools. */
const goneWith = (tool: ToolName): string[] => (tool === 'render_document' ? [tool, 'get_render_result'] : [tool]);

interface Surface { tools: string[]; resources: string[]; texts: Record<string, string>; routes?: { upload: number; webhook: number }; refusal?: string }

/** What is left reads well: no empty description, no run of blank lines, numbered headings in order. */
function expectReadable(surface: Surface, where: string) {
  for (const [name, text] of Object.entries(surface.texts)) {
    expect(text, `${where}, ${name}: no run of blank lines`).not.toMatch(/\n\n\n/);
    const descriptions = [...text.matchAll(/"description":"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]);
    expect(descriptions.filter((description) => !description), `${where}, ${name}: no empty description`).toEqual([]);
    const numbers = [...text.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]));
    expect(numbers, `${where}, ${name}: numbered headings in order`).toEqual(numbers.map((_, i) => numbers[0]! + i));
  }
}

/** What a client sees, and how a call to the first disabled tool (if any) is refused. */
async function surfaceOf(client: Client, disabled: ReadonlySet<ToolName>): Promise<Surface> {
  const { tools } = await client.listTools();
  const { resources } = await client.listResources();
  const { resourceTemplates } = await client.listResourceTemplates();
  const texts: Record<string, string> = { instructions: client.getInstructions() ?? '' };
  for (const r of [...resources, ...resourceTemplates]) texts[`${r.name} resource`] = JSON.stringify(r);
  const result = await client.callTool({ name: 'get_capabilities', arguments: {} });
  texts['get_capabilities'] = (result.content as Array<{ text: string }>)[0]!.text;
  for (const t of tools) texts[`${t.name} listing`] = JSON.stringify(t);
  const off = [...disabled][0];
  const refusal = off && await client.callTool({ name: off, arguments: {} }).then(() => 'called', (e: Error) => e.message);
  return { tools: tools.map((t) => t.name), resources: [...resources, ...resourceTemplates].map((r) => r.name), texts, ...(refusal && { refusal }) };
}

/** stdio, set up as src/index.ts does. */
async function stdioClient(disabled: ReadonlySet<ToolName>, carbone = new CarboneClient({ apiKey: 'unused' })): Promise<Client> {
  const skills = await loadServedSkills(() => {});
  const skill = servesCarboneSkill(skills);
  const server = new McpServer(serverInfo('0.0.0-test'), serverOptionsFor({ ...STDIO_IO, skill }, disabled));
  registerTools(server, carbone, { allowFileOutput: true, allowFileInput: true, allowPrivateNetwork: false, maxFileBytes: 1024, skill }, disabled);
  registerResources(server, carbone, disabled);
  skills?.attach(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'disabled-tools-test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function stdioSurface(disabled: ReadonlySet<ToolName>): Promise<Surface> {
  const client = await stdioClient(disabled);
  try { return await surfaceOf(client, disabled); } finally { await client.close(); }
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
    return { ...await surfaceOf(client, disabledTools), routes: { upload: await post('/upload'), webhook: await post('/webhook') } };
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

  test('without MCP_ENABLED_TOOLS: every tool and resource', () => {
    expect([...all.tools].sort()).toEqual([...expectedTools].sort());
    expect([...all.resources].sort()).toEqual([...Object.values(RESOURCES_OF).flat(), ...SKILL_RESOURCES].sort());
  });

  test.each(DISABLEABLE_TOOLS)('%s disabled: not registered, named nowhere, no other tool name lost', async (tool) => {
    const left = await surface(new Set([tool]));
    const gone = goneWith(tool);
    expectReadable(left, `${tool} off`);
    expect(left.refusal, 'a call to it is refused as an unknown tool').toMatch(new RegExp(`Tool ${tool} not found`));
    expect(left.tools).toEqual(all.tools.filter((t) => !gone.includes(t)));
    expect(left.resources).toEqual(all.resources.filter((r) => !RESOURCES_OF[tool]?.includes(r)));
    const listedUris = JSON.stringify(Object.entries(left.texts).filter(([where]) => where.endsWith(' resource')));
    for (const [where, text] of Object.entries(left.texts)) {
      expect(named(text), where).not.toContain(tool);
      expect(withoutTools(text, new Set([tool])), `${where}: filtering again changes nothing`).toBe(text);
      // Every carbone:// resource a text mentions is one the model can read.
      for (const uri of text.match(/carbone:\/\/[a-z]+/g) ?? []) expect(listedUris, `${where} names ${uri}`).toContain(uri);
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

test.each([['stdio', stdioSurface], ['HTTP', httpSurface]] as const)(
  'read-only agent (%s): what the filter leaves of every text it changes (review the snapshot when a text changes)', async (_mode, surface) => {
    const all = await surface(NO_TOOLS);
    const readOnly = await surface(new Set<ToolName>(['delete_template', 'upload_template', 'update_template_metadata']));
    const changed = Object.fromEntries(Object.entries(readOnly.texts).filter(([where, text]) => text !== all.texts[where]));
    expect(changed).toMatchSnapshot();
  });

describe.each([['stdio', stdioSurface], ['HTTP', httpSurface]] as const)('%s with a single tool enabled', (_mode, surface) => {
  test.each(DISABLEABLE_TOOLS)('only %s: the texts name it and get_capabilities alone, and read well', async (tool) => {
    const left = await surface(new Set(DISABLEABLE_TOOLS.filter((t) => t !== tool)));
    expectReadable(left, `only ${tool}`);
    for (const [where, text] of Object.entries(left.texts)) {
      expect(named(text).filter((t) => t !== tool && t !== 'get_capabilities'), where).toEqual([]);
    }
  });
});

test('an error message leaves out the disabled tools and their resources', async () => {
  const carbone = { deleteTemplate: vi.fn(async () => { throw new CarboneNotFoundError('Template not found'); }) } as unknown as CarboneClient;
  const client = await stdioClient(new Set(['list_templates']), carbone);
  try {
    const result = await client.callTool({ name: 'delete_template', arguments: { templateId: '1530905183164918624' } });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(result.isError).toBe(true);
    expect(text).toMatch(/^Not found: Template not found/);
    expect(text).not.toMatch(/list_templates|carbone:\/\/templates/);
  } finally {
    await client.close();
  }
});

test('every alias of a tool appears in a text the server shows, so that a rewording is noticed', async () => {
  const texts = JSON.stringify((await httpSurface(NO_TOOLS)).texts);
  for (const alias of Object.keys(TOOL_ALIASES)) expect(texts, alias).toContain(alias);
});

test('an error message the filter would empty (a file the user named after a tool) is kept as is', async () => {
  const carbone = { deleteTemplate: vi.fn(async () => { throw new Error('cannot read list_templates.json'); }) } as unknown as CarboneClient;
  const client = await stdioClient(new Set(['list_templates']), carbone);
  try {
    const result = await client.callTool({ name: 'delete_template', arguments: { templateId: '1530905183164918624' } });
    expect((result.content as Array<{ text: string }>)[0]!.text).toBe('Unexpected error: cannot read list_templates.json');
  } finally {
    await client.close();
  }
});

test('a resource still served reads as before when another tool is left out', async () => {
  const carbone = { getTags: vi.fn(async () => ['a', 'b']) } as unknown as CarboneClient;
  const client = await stdioClient(new Set(['list_templates']), carbone);
  try {
    const { contents } = await client.readResource({ uri: 'carbone://tags' });
    expect(JSON.parse((contents[0] as { text: string }).text)).toEqual(['a', 'b']);
    await expect(client.readResource({ uri: 'carbone://templates' })).rejects.toThrow();
  } finally {
    await client.close();
  }
});

test('with tools left out, every resource still served reads through its own callback', async () => {
  const carbone = {
    listTemplates: vi.fn(async () => ({ templates: [{ id: '1', name: 'Invoice' }] })),
    getCategories: vi.fn(async () => ['legal']),
    getStatus: vi.fn(async () => ({ version: '5.18.0' })),
  } as unknown as CarboneClient;
  const client = await stdioClient(new Set(['delete_template', 'list_tags']), carbone);
  try {
    for (const uri of ['carbone://templates', 'carbone://templates/1', 'carbone://categories', 'carbone://status']) {
      const { contents } = await client.readResource({ uri });
      expect(contents[0]?.uri, uri).toBe(uri);
    }
    expect([carbone.listTemplates, carbone.getCategories, carbone.getStatus].every((fn) => vi.mocked(fn).mock.calls.length)).toBe(true);
  } finally {
    await client.close();
  }
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
