import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/utils/file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/file.js')>();
  return { ...actual, resolveFileInput: vi.fn() };
});

import { handleInspectTemplate, normaliseInspection } from '../../../src/tools/inspect.js';
import { resolveFileInput } from '../../../src/utils/file.js';
import { CarboneClient } from '../../../src/carbone/client.js';
import { CarboneAuthError, CarboneError } from '../../../src/carbone/errors.js';

// The live api.carbone.io `data.debug` of a render with isDebugActive.
const DEBUG = {
  markers: ['{d.customer.name}', '{d.total:formatN(2)}', '{d.items[i].label}', '{d.items[i+1].label}', '{c.company}'],
  sample: { data: { total: 0, customer: { name: 'name1' }, items: [{ label: 'label2' }] }, complement: { company: 'company3' } },
  error: {},
  signatures: [],
  metrics: { renderTime: 12 },
};

const makeClient = (debug: unknown = DEBUG) =>
  ({
    isCloud: true,
    assertCanAuthenticate: vi.fn(),
    inspectTemplate: vi.fn().mockResolvedValue(debug),
  }) as unknown as CarboneClient;

const textOf = (r: { content: Array<{ type: string; text?: string }> }) => r.content[0]!.text ?? '';

describe('handleInspectTemplate', () => {
  beforeEach(() => {
    vi.mocked(resolveFileInput).mockReset();
    vi.mocked(resolveFileInput).mockResolvedValue('resolved-base64==');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('stored template: returns tags + sample, drops empty error/signatures and extra fields (metrics)', async () => {
    const client = makeClient();
    const result = await handleInspectTemplate({ templateId: 'tpl1' }, client, { apiKey: 'k' });

    expect(resolveFileInput).not.toHaveBeenCalled();
    expect(vi.mocked(client.inspectTemplate)).toHaveBeenCalledWith({ templateId: 'tpl1' }, { apiKey: 'k' });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ tags: DEBUG.markers, sample: DEBUG.sample });

    const text = textOf(result);
    expect(text).toContain('Carbone tags used by this template (5):');
    expect(text).toContain('- {d.items[i].label}');
    expect(text).toContain(JSON.stringify(DEBUG.sample, null, 2)); // pretty-printed sample
    expect(text.indexOf('{c.company}')).toBeLessThan(text.indexOf('Sample data')); // tags first, then sample
  });

  test('inline template: resolved first (with the transport gates), then inspected', async () => {
    const client = makeClient();
    await handleInspectTemplate({ template: 'https://example.com/t.docx' }, client, undefined, {
      allowFileOutput: false, allowFileInput: false, allowPrivateNetwork: false, maxFileBytes: 1000,
    });

    expect(resolveFileInput).toHaveBeenCalledWith('https://example.com/t.docx', {
      isCloud: true, maxBytes: 1000, allowLocalPath: false, allowPrivateNetwork: false,
    });
    expect(vi.mocked(client.inspectTemplate)).toHaveBeenCalledWith({ template: 'resolved-base64==' }, undefined);
  });

  test('forwards the abort signal and the per-call apiKey', async () => {
    const client = makeClient();
    const signal = new AbortController().signal;
    await handleInspectTemplate({ templateId: 'tpl1' }, client, { apiKey: 'bearer', signal });

    expect(vi.mocked(client.inspectTemplate)).toHaveBeenCalledWith({ templateId: 'tpl1' }, { apiKey: 'bearer', signal });
  });

  test('keeps signatures and error only when they are non-empty', async () => {
    const client = makeClient({ ...DEBUG, signatures: [{ id: 'sig1' }], error: { message: 'bad tag' } });
    const result = await handleInspectTemplate({ templateId: 'tpl1' }, client);

    expect(result.structuredContent).toEqual({
      tags: DEBUG.markers, sample: DEBUG.sample, signatures: [{ id: 'sig1' }], error: { message: 'bad tag' },
    });
    expect(textOf(result)).toContain('Carbone reported an error');
  });

  test('normalises nulls: null markers/sample/error/signatures and null entries never reach the output schema', () => {
    expect(normaliseInspection({ markers: null, sample: null, error: null, signatures: null })).toEqual({ tags: [], sample: {} });
    expect(normaliseInspection({ markers: ['{d.a}', null, 3], sample: { data: null } })).toEqual({ tags: ['{d.a}'], sample: { data: null } });
    expect(normaliseInspection({})).toEqual({ tags: [], sample: {} });
    expect(normaliseInspection({ markers: [], sample: [], error: 'boom' })).toEqual({ tags: [], sample: {}, error: { message: 'boom' } });
  });

  test('a template without tags says so', async () => {
    const result = await handleInspectTemplate({ templateId: 'tpl1' }, makeClient({ markers: [], sample: {} }));
    expect(textOf(result)).toMatch(/^No Carbone tags found/);
  });

  test('a Carbone server without the feature (no debug) returns a clear error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify({ success: true, data: { renderId: 'r.docx' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
    const client = new CarboneClient({ baseUrl: 'https://carbone.example.test' });

    const result = await handleInspectTemplate({ templateId: 'tpl1' }, client);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/This Carbone server returned no inspection data/);
  });

  test.each([
    ['both', { templateId: 'tpl1', template: 'abc' }],
    ['neither', {}],
  ])('rejects %s of templateId / template with the render_document message', async (_label, args) => {
    const client = makeClient();
    const result = await handleInspectTemplate(args, client);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Provide either templateId or template, not both (and not neither).');
    expect(vi.mocked(client.inspectTemplate)).not.toHaveBeenCalled();
  });

  test('checks authentication BEFORE resolving the template (no URL is fetched without credentials)', async () => {
    const client = {
      isCloud: true,
      assertCanAuthenticate: vi.fn(() => { throw new CarboneAuthError('No API key provided.'); }),
      inspectTemplate: vi.fn(),
    } as unknown as CarboneClient;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await handleInspectTemplate({ template: 'https://example.com/t.docx' }, client, { apiKey: undefined });

    expect(client.assertCanAuthenticate).toHaveBeenCalledWith({ apiKey: undefined });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Authentication failed');
    expect(resolveFileInput).not.toHaveBeenCalled();
    expect(vi.mocked(client.inspectTemplate)).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('returns isError on a Carbone error', async () => {
    const client = makeClient();
    vi.mocked(client.inspectTemplate).mockRejectedValueOnce(new CarboneError('Template not found', 404));
    const result = await handleInspectTemplate({ templateId: 'nope' }, client);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Template not found');
  });
});
