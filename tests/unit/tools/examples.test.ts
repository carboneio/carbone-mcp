import { describe, test, expect, vi } from 'vitest';
import {
  ExampleCatalog, conversionOf, findExamples, handleFindTemplateExamples, parseCatalog, renderArguments, type Catalog,
} from '../../../src/tools/examples.js';
import { RenderDocumentSchema } from '../../../src/validation/schemas.js';

const files = (id: string, template: string, result: string) => ({
  template: `https://carbone.io/examples/${id}/template.${template}`, data: `https://carbone.io/examples/${id}/data.json`,
  result: `https://carbone.io/examples/${id}/result.${result}`, thumbnail: `https://carbone.io/examples/${id}/thumb-result.webp`,
});

const gallery = (id: string, over: Record<string, unknown> = {}) => ({
  id, category: 'showcase', title: `Title ${id}`, subTitle: 'Sub', description: 'Desc',
  url: `https://carbone.io/examples/${id}/`, markdownUrl: `https://carbone.io/examples/${id}/index.md`,
  useCase: 'finance', documentType: 'document', templateExtension: 'docx', resultExtension: 'pdf', dataSource: 'custom',
  difficultyLevel: 'simple', carboneVersion: '5.0.0', new: false, documentTags: [], featureUsed: [],
  files: files(id, 'docx', 'pdf'), ...over,
});

const CATALOG = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  useCases: [{ id: 'finance', label: 'Finance' }, { id: 'logistics', label: 'Logistics' }],
  examples: [
    gallery('invoice', { title: 'Utility invoice', documentTags: ['invoice', 'barcode'], featureUsed: ['loop', 'barcode'], difficultyLevel: 'expert' }),
    gallery('budget', { title: 'Budget report', templateExtension: 'xlsx', resultExtension: 'xlsx', featureUsed: ['chart'], new: true, files: files('budget', 'xlsx', 'xlsx') }),
    gallery('factsheet', { title: 'Fund factsheet', templateExtension: 'html', difficultyLevel: 'medium', files: files('factsheet', 'html', 'pdf') }),
    gallery('edi', { title: 'EDIFACT message', useCase: 'logistics', templateExtension: 'txt', resultExtension: 'txt', resultFormat: 'EDI', files: files('edi', 'txt', 'txt') }),
    gallery('evil', { files: { template: 'https://evil.test/t.docx', data: 'https://carbone.io/d.json' } }),
    gallery('plain-http', { markdownUrl: 'http://carbone.io/examples/x/index.md' }),
    { id: 'broken' },
  ],
  formatGuideExamples: [{
    id: 'docx-translations', category: 'format-guide', title: 'DOCX template: translations', description: 'Translated letter',
    url: 'https://carbone.io/documentation/design/template-formats/docx.html#translations',
    markdownUrl: 'https://carbone.io/documentation/design/template-formats/docx.md',
    guide: { title: 'DOCX templates', section: 'Translations', url: 'https://carbone.io/documentation/design/template-formats/docx.html' },
    templateExtension: 'docx', resultExtension: 'docx', difficultyLevel: 'simple',
    files: {
      template: 'https://carbone.io/file/docx/translations-template.docx', data: 'https://carbone.io/file/docx/translations-data.json',
      result: null, translations: 'https://carbone.io/file/docx/translations-translations.json', additional: [],
      screenshots: { template: [], result: ['https://carbone.io/img/doc/docx-translations-result.webp'] },
    },
  }],
};

const parsed = (): Catalog => parseCatalog(structuredClone(CATALOG));
const ids = (list: Array<{ id: string }>) => list.map((e) => e.id);

describe('parseCatalog', () => {
  test('keeps the valid entries only: carbone.io HTTPS files, the expected fields', () => {
    expect(ids(parsed().examples)).toEqual(['invoice', 'budget', 'factsheet', 'edi', 'docx-translations']);
  });

  test('levels read as words, a label keeps the real extension for convertTo', () => {
    const [invoice, , factsheet, edi] = parsed().examples;
    expect([invoice!.level, factsheet!.level]).toEqual(['advanced', 'intermediate']);
    expect(edi).toMatchObject({ resultFormat: 'txt', resultLabel: 'EDI' });
  });

  test('the optional conversion: only when the example shows another format; Chromium advised for HTML and SVG, else the default', () => {
    const byId = Object.fromEntries(parsed().examples.map((e) => [e.id, conversionOf(e)]));
    expect(byId).toEqual({
      invoice: { convertTo: 'pdf' }, budget: undefined, factsheet: { convertTo: 'pdf', converter: 'C' }, edi: undefined, 'docx-translations': undefined,
    });
    expect(conversionOf({ ...parsed().examples[2]!, resultFormat: 'zpl' })).toBeUndefined();
  });

  test('refuses another format version, or a file without a usable example', () => {
    expect(() => parseCatalog({ ...CATALOG, version: 2 })).toThrow();
    expect(() => parseCatalog({ ...CATALOG, examples: [{ id: 'broken' }], formatGuideExamples: [] })).toThrow('no usable example');
    expect(() => parseCatalog('nope')).toThrow();
  });
});

describe('findExamples', () => {
  test('no filter: gallery first, the new ones first', () => {
    expect(ids(findExamples(parsed(), {}))).toEqual(['budget', 'invoice', 'factsheet', 'edi', 'docx-translations']);
  });

  test('keywords rank by the words matched, then where; plurals and "template" are ignored', () => {
    expect(ids(findExamples(parsed(), { query: 'barcodes invoice templates' }))[0]).toBe('invoice');
    expect(ids(findExamples(parsed(), { query: 'nothing like this' }))).toEqual([]);
  });

  test('format names people use: excel, word', () => {
    expect(ids(findExamples(parsed(), { query: 'excel' }))).toEqual(['budget']);
    expect(ids(findExamples(parsed(), { query: 'word translation' }))[0]).toBe('docx-translations');
  });

  test('filters: use case, formats (any case, with a dot), result label, level, kind, id', () => {
    const catalog = parsed();
    expect(ids(findExamples(catalog, { useCase: 'logistics' }))).toEqual(['edi']);
    expect(ids(findExamples(catalog, { templateFormat: '.HTML' }))).toEqual(['factsheet']);
    expect(ids(findExamples(catalog, { resultFormat: 'edi' }))).toEqual(['edi']);
    expect(ids(findExamples(catalog, { level: 'advanced' }))).toEqual(['invoice']);
    expect(ids(findExamples(catalog, { kind: 'format-guide' }))).toEqual(['docx-translations']);
    expect(ids(findExamples(catalog, { id: 'budget' }))).toEqual(['budget']);
  });
});

describe('renderArguments', () => {
  test('fill the template with its data, nothing more: valid render_document arguments, with or without the conversion', () => {
    for (const example of parsed().examples) {
      expect(RenderDocumentSchema.safeParse(renderArguments(example)).success).toBe(true);
      expect(RenderDocumentSchema.safeParse({ ...renderArguments(example), ...conversionOf(example) }).success).toBe(true);
    }
    const [, , factsheet, , guide] = parsed().examples;
    expect(renderArguments(factsheet!)).toEqual({
      template: 'https://carbone.io/examples/factsheet/template.html', data: 'https://carbone.io/examples/factsheet/data.json',
    });
    expect(renderArguments(guide!)).toEqual({
      template: 'https://carbone.io/file/docx/translations-template.docx', data: 'https://carbone.io/file/docx/translations-data.json',
      translations: 'https://carbone.io/file/docx/translations-translations.json',
    });
  });
});

/** A catalog that answers `body` once loaded, without the network. */
const catalogOf = (body: unknown) => new ExampleCatalog({ fetch: async () => Response.json(body), warn: () => {} });

describe('find_template_examples', () => {
  test('lists each example with its renderArguments, and the next steps', async () => {
    const result = await handleFindTemplateExamples({ query: 'factsheet' }, catalogOf(CATALOG));
    const text = result.content[0]!.text;
    expect(text).toMatch(/^1 example matches\. To generate one: render_document with its renderArguments/);
    expect(text).toContain('- renderArguments: {"template":"https://carbone.io/examples/factsheet/template.html",');
    expect(text).toContain('A conversion (convertTo) is optional');
    expect(text).toContain('- optional, to get PDF as in the example: add {"convertTo":"pdf","converter":"C"}');
    expect(result.structuredContent).toMatchObject({ total: 1, examples: [{ id: 'factsheet', conversion: { convertTo: 'pdf', converter: 'C' } }] });
    expect(result.structuredContent!.examples[0]!.renderArguments).not.toHaveProperty('convertTo');
  });

  test('DOCX to PDF mentions Carbone ICE; translations ask for lang', async () => {
    const catalog = catalogOf(CATALOG);
    expect((await handleFindTemplateExamples({ id: 'invoice' }, catalog)).content[0]!.text).toContain('(converter "I", Carbone ICE, is faster)');
    expect((await handleFindTemplateExamples({ id: 'docx-translations' }, catalog)).content[0]!.text).toContain('(add lang');
  });

  test('the preview is the image published with the example (gallery thumbnail, guide screenshot): no render suggested', async () => {
    const catalog = catalogOf(CATALOG);
    const invoice = await handleFindTemplateExamples({ id: 'invoice' }, catalog);
    expect(invoice.content[0]!.text).toContain('- preview of the result (image): https://carbone.io/examples/invoice/thumb-result.webp');
    expect(invoice.content[0]!.text).not.toContain('png');
    expect(invoice.structuredContent).toMatchObject({ examples: [{ files: { preview: 'https://carbone.io/examples/invoice/thumb-result.webp' } }] });
    expect((await handleFindTemplateExamples({ id: 'docx-translations' }, catalog)).structuredContent)
      .toMatchObject({ examples: [{ files: { preview: 'https://carbone.io/img/doc/docx-translations-result.webp' } }] });
  });

  test('the use cases come with an unfiltered list (a limit is no filter), and with no match', async () => {
    const catalog = catalogOf(CATALOG);
    expect((await handleFindTemplateExamples({ limit: 1 }, catalog)).content[0]!.text).toContain('Use cases: finance (Finance), logistics (Logistics).');
    expect((await handleFindTemplateExamples({ useCase: 'finance' }, catalog)).content[0]!.text).not.toContain('Use cases:');
    const none = (await handleFindTemplateExamples({ useCase: 'medical' }, catalog)).content[0]!.text;
    expect(none).toBe('No example matches. Try fewer filters or other keywords. Use cases: finance, logistics. Template formats: docx, xlsx, html, txt.');
  });

  test('limit: total counts every match', async () => {
    const result = await handleFindTemplateExamples({ limit: 2 }, catalogOf(CATALOG));
    expect(result.structuredContent).toMatchObject({ total: 5 });
    expect(result.structuredContent!.examples).toHaveLength(2);
    expect(result.content[0]!.text).toMatch(/^5 examples match, 2 shown\./);
  });

  test('a catalog that never loaded: an error that points to the web gallery', async () => {
    const result = await handleFindTemplateExamples({}, new ExampleCatalog({ fetch: async () => { throw new Error('down'); }, warn: () => {} }));
    expect(result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('https://carbone.io/examples/') }] });
  });
});

describe('ExampleCatalog cache', () => {
  const DAY = 24 * 60 * 60 * 1000, RETRY = 10 * 60 * 1000;
  const body = JSON.stringify(CATALOG);

  /** A catalog on a fake clock, whose fetches answer `answers` in turn (the last one repeats). */
  function setup(...answers: Array<() => Response | Promise<Response>>) {
    let now = 0;
    const warn = vi.fn();
    const calls: RequestInit[] = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init!);
      return answers[Math.min(calls.length, answers.length) - 1]!();
    });
    const catalog = new ExampleCatalog({ fetch: fetch as typeof globalThis.fetch, now: () => now, warn });
    /** get(), then lets a background check finish. */
    const get = async () => { const value = await catalog.get(); await new Promise((r) => setTimeout(r, 0)); return value; };
    return { catalog, get, fetch, warn, calls, tick: (ms: number) => { now += ms; } };
  }
  const ok = (text = body, headers: Record<string, string> = { etag: '"v1"' }) => () => new Response(text, { headers });

  test('loads once, then serves from memory for a day', async () => {
    const s = setup(ok());
    const first = await s.get();
    s.tick(DAY - 1);
    expect(await s.get()).toBe(first);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  test('concurrent first calls share one fetch', async () => {
    const s = setup(ok());
    const [a, b] = await Promise.all([s.catalog.get(), s.catalog.get()]);
    expect(a).toBe(b);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  test('after a day: a conditional request; 304 keeps the same copy', async () => {
    const s = setup(ok(), () => new Response(null, { status: 304 }));
    const first = await s.get();
    s.tick(DAY);
    expect(await s.get()).toBe(first);
    expect(s.calls[1]!.headers).toMatchObject({ 'if-none-match': '"v1"' });
    expect(s.warn).not.toHaveBeenCalled();
  });

  test('the same bytes again (same SHA-256, so the same generatedAt): the parsed copy stays', async () => {
    const s = setup(ok(), ok(body, { etag: '"v2"' }));
    const first = await s.get();
    s.tick(DAY);
    await s.get();
    expect(await s.get()).toBe(first);
  });

  test('a changed file replaces the copy; the stale copy is served while it is checked', async () => {
    const changed = JSON.stringify({ ...CATALOG, generatedAt: '2026-02-01T00:00:00.000Z' });
    let release!: () => void;
    const s = setup(ok(), () => new Promise<Response>((resolve) => { release = () => resolve(ok(changed)()); }));
    const first = await s.get();
    s.tick(DAY);
    expect(await s.catalog.get()).toBe(first); // not waiting for the check
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect((await s.catalog.get())!.generatedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  const failures: Array<[string, () => Response | Promise<Response>]> = [
    ['DNS', () => { throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND carbone.io') }); }],
    ['network', () => { throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') }); }],
    ['timeout', () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }],
    ['a redirect', () => { throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') }); }],
    ['HTTP 500', () => new Response('oops', { status: 500 })],
    ['HTTP 404', () => new Response('oops', { status: 404 })],
    ['a 304 with nothing in memory', () => new Response(null, { status: 304 })],
    ['a declared size too large', () => new Response('{}', { headers: { 'content-length': String(5 * 1024 * 1024) } })],
    ['a body too large', () => new Response('x'.repeat(4 * 1024 * 1024 + 1))],
    ['broken JSON', () => new Response('{"version":1,')],
    ['an HTML page', () => new Response('<html>maintenance</html>')],
    ['another format version', () => Response.json({ ...CATALOG, version: 2 })],
    ['no usable example', () => Response.json({ ...CATALOG, examples: [], formatGuideExamples: [] })],
  ];

  test.each(failures)('%s on the first load: nothing loaded, retried after 10 minutes only', async (_, failure) => {
    const s = setup(failure, ok());
    expect(await s.get()).toBeUndefined();
    expect(s.warn).toHaveBeenCalledTimes(1);
    s.tick(RETRY - 1);
    expect(await s.get()).toBeUndefined();
    expect(s.fetch).toHaveBeenCalledTimes(1);
    s.tick(1);
    expect(await s.get()).toBeDefined();
  });

  // A 304 on a refresh is no failure: the copy in memory is still current.
  test.each(failures.filter(([name]) => !name.startsWith('a 304')))('%s on a refresh: the last good copy stays, retried after 10 minutes', async (_, failure) => {
    const s = setup(ok(), failure, ok(JSON.stringify({ ...CATALOG, generatedAt: 'later' })));
    const first = await s.get();
    s.tick(DAY);
    expect(await s.get()).toBe(first);
    expect(s.warn).toHaveBeenCalledTimes(1);
    s.tick(RETRY - 1);
    await s.get();
    expect(s.fetch).toHaveBeenCalledTimes(2);
    s.tick(1);
    await s.get();
    expect((await s.catalog.get())!.generatedAt).toBe('later');
  });

  test('the warning names the cause', async () => {
    const s = setup(failures[0]![1]);
    await s.get();
    expect(s.warn).toHaveBeenCalledWith('fetch failed: getaddrinfo ENOTFOUND carbone.io');
  });

  test('never follows a redirect, and times out', async () => {
    const s = setup(ok());
    await s.get();
    expect(s.calls[0]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
  });
});
