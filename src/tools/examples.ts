import { createHash } from 'node:crypto';
import { z } from 'zod';
import { log } from '../server/log.js';
import { OUTPUT_FORMATS } from '../validation/formats.js';
import type { ToolName } from './toolNames.js';

// ─── The catalog ──────────────────────────────────────────────────────────────

/** Carbone's examples: the gallery (carbone.io/examples) and the Template Formats guides, with their files. */
export const EXAMPLES_URL = 'https://carbone.io/examples/examples.json';

const REFRESH_MS = 24 * 60 * 60 * 1000;
/** After a failed check, the copy in memory (if any) is kept, and the next check waits this long. */
const RETRY_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 10_000;
/** The catalog is about 250 KB: anything far larger is not it. */
const MAX_BYTES = 4 * 1024 * 1024;

/** Only carbone.io files are passed on: the model hands them to render_document as they are. */
const carboneUrl = z.url({ protocol: /^https$/, hostname: /^(?:[a-z0-9-]+\.)*carbone\.io$/ });
const text = z.string().max(2000);
const list = z.array(z.string().max(100)).max(100).catch([]);

const galleryEntry = z.object({
  id: z.string().max(100), title: text, subTitle: text.optional(), description: text, markdownUrl: carboneUrl,
  useCase: z.string().max(100).optional(), templateExtension: z.string().max(10), resultExtension: z.string().max(10),
  resultFormat: z.string().max(20).optional(), difficultyLevel: z.string().max(20), carboneVersion: z.string().max(20).optional(),
  new: z.boolean().catch(false), documentTags: list, featureUsed: list,
  files: z.object({ template: carboneUrl, data: carboneUrl.optional(), result: carboneUrl.optional(), thumbnail: carboneUrl.optional().catch(undefined) }),
});

const guideEntry = z.object({
  id: z.string().max(100), title: text, description: text, markdownUrl: carboneUrl,
  guide: z.object({ title: text, section: text }).optional(),
  templateExtension: z.string().max(10), resultExtension: z.string().max(10), difficultyLevel: z.string().max(20),
  files: z.object({
    template: carboneUrl, data: carboneUrl.nullish(), result: carboneUrl.nullish(), translations: carboneUrl.nullish(),
    additional: z.array(carboneUrl).max(20).catch([]),
    screenshots: z.object({ result: z.array(carboneUrl).max(20) }).optional().catch(undefined),
  }),
});

const catalogFile = z.object({
  version: z.literal(1), // a new major format is refused: the copy in memory stays
  generatedAt: z.string().max(40),
  useCases: z.array(z.object({ id: z.string().max(100), label: text })).catch([]),
  examples: z.array(z.unknown()),
  formatGuideExamples: z.array(z.unknown()).catch([]),
});

export type ExampleKind = 'gallery' | 'format-guide';
export const LEVELS = { simple: 'beginner', medium: 'intermediate', expert: 'advanced' } as const;

export interface Example {
  id: string;
  kind: ExampleKind;
  title: string;
  description: string;
  templateFormat: string;
  /** A convertTo value. */
  resultFormat: string;
  /** What the result is when its extension does not say it (EDI, ZPL or ACH in a .txt). */
  resultLabel?: string;
  level: string;
  useCase?: string;
  features: string[];
  keywords: string[];
  carboneVersion?: string;
  isNew: boolean;
  /** The explained example, as Markdown. */
  page: string;
  /** preview: an image of the result, published with the example. */
  files: { template: string; data?: string; result?: string; preview?: string; translations?: string; other?: string[] };
}

export interface Catalog { generatedAt: string; useCases: Array<{ id: string; label: string }>; examples: Example[] }

const level = (value: string) => LEVELS[value as keyof typeof LEVELS] ?? value;
const lower = (value: string) => value.toLowerCase();

/**
 * The converter to recommend for a conversion: Chromium for an HTML or SVG template, as the example pages advise. None
 * for the others, whose default LibreOffice ("L") has the widest compatibility.
 */
const converterOf = (templateFormat: string) => (/^(?:x?html|svg)$/.test(templateFormat) ? { converter: 'C' as const } : {});

/** Whether generating `e` changes its format (a convertTo value Carbone takes). */
const converts = (e: Example) => e.resultFormat !== e.templateFormat && (OUTPUT_FORMATS as readonly string[]).includes(e.resultFormat);

/** Carbone ICE converts these to PDF, 3x to 300x faster than LibreOffice. */
const iceFaster = (e: Example) => converts(e) && /^(?:docx|odt)$/.test(e.templateFormat) && e.resultFormat === 'pdf';

/** The catalog in `json`, keeping the entries that parse; throws when the file is not one, or has no usable example. */
export function parseCatalog(json: unknown): Catalog {
  const file = catalogFile.parse(json);
  const examples: Example[] = [];
  for (const raw of file.examples) {
    const e = galleryEntry.safeParse(raw);
    if (!e.success) continue;
    const { data: x } = e;
    examples.push({
      id: x.id, kind: 'gallery', title: x.title, description: x.subTitle ? `${x.subTitle}. ${x.description}` : x.description,
      templateFormat: lower(x.templateExtension), resultFormat: lower(x.resultExtension), resultLabel: x.resultFormat,
      level: level(x.difficultyLevel), useCase: x.useCase, features: x.featureUsed, keywords: x.documentTags,
      carboneVersion: x.carboneVersion, isNew: x.new, page: x.markdownUrl,
      files: { template: x.files.template, data: x.files.data, result: x.files.result, preview: x.files.thumbnail },
    });
  }
  for (const raw of file.formatGuideExamples) {
    const e = guideEntry.safeParse(raw);
    if (!e.success) continue;
    const { data: x } = e;
    const page = x.guide ? `${x.markdownUrl} (section "${x.guide.section}")` : x.markdownUrl;
    examples.push({
      id: x.id, kind: 'format-guide', title: x.title, description: x.description,
      templateFormat: lower(x.templateExtension), resultFormat: lower(x.resultExtension), level: level(x.difficultyLevel),
      features: [], keywords: x.guide ? [x.guide.title, x.guide.section] : [], isNew: false, page,
      files: {
        template: x.files.template, data: x.files.data ?? undefined, result: x.files.result ?? undefined,
        preview: x.files.screenshots?.result[0],
        translations: x.files.translations ?? undefined, ...(x.files.additional.length && { other: x.files.additional }),
      },
    });
  }
  if (!examples.length) throw new Error('no usable example in the catalog');
  return { generatedAt: file.generatedAt, useCases: file.useCases, examples };
}

/** The body of `response`, refused past `max` bytes (Content-Length is not trusted). */
async function readCapped(response: Response, max: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > max) throw new Error('catalog too large');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > max) throw new Error('catalog too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

interface Loaded { catalog: Catalog; sha256: string; etag?: string }

/**
 * Carbone's examples catalog, fetched on first use and checked again once a day, never on a request's critical path
 * once loaded. A check that fails in any way (DNS, network, timeout, HTTP status, size, JSON, format) changes nothing:
 * the last good copy stays, and the next check waits RETRY_MS. An unchanged file (304, or the same SHA-256) is not parsed again.
 */
export class ExampleCatalog {
  private loaded?: Loaded;
  private nextCheck = 0;
  private checking?: Promise<void>;
  /** Where a failed check is reported: the HTTP log by default, stdio sets its diagnostics. */
  warn: (error: string) => void;

  constructor(private readonly options: { url?: string; fetch?: typeof fetch; now?: () => number; warn?: (error: string) => void } = {}) {
    this.warn = options.warn ?? ((error) => log('warn', { msg: 'examples catalog not refreshed', error }));
  }

  /** The catalog, or undefined when it has never loaded. Only the first load is waited for. */
  async get(): Promise<Catalog | undefined> {
    if (!this.checking && this.now() >= this.nextCheck) this.checking = this.check().finally(() => (this.checking = undefined));
    if (!this.loaded) await this.checking;
    return this.loaded?.catalog;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private async check(): Promise<void> {
    try {
      const etag = this.loaded?.etag;
      const response = await (this.options.fetch ?? globalThis.fetch)(this.options.url ?? EXAMPLES_URL, {
        headers: { accept: 'application/json', ...(etag && { 'if-none-match': etag }) },
        redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 304 && this.loaded) return this.checked(this.loaded, REFRESH_MS);
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      const body = await readCapped(response, MAX_BYTES);
      const sha256 = createHash('sha256').update(body).digest('hex');
      const next = response.headers.get('etag') ?? undefined;
      // The same bytes (generatedAt included): the parsed copy stays.
      if (sha256 === this.loaded?.sha256) return this.checked({ ...this.loaded, etag: next }, REFRESH_MS);
      this.checked({ catalog: parseCatalog(JSON.parse(body.toString('utf8'))), sha256, etag: next }, REFRESH_MS);
    } catch (error) {
      this.nextCheck = this.now() + RETRY_MS;
      this.warn(error instanceof Error ? (error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message) : String(error));
    }
  }

  private checked(loaded: Loaded, wait: number): void {
    this.loaded = loaded;
    this.nextCheck = this.now() + wait;
  }
}

/** One per process: every McpServer (one per HTTP request) shares it. */
export const exampleCatalog = new ExampleCatalog();

// ─── find_template_examples ───────────────────────────────────────────────────

export const findTemplateExamplesToolName = 'find_template_examples' satisfies ToolName;

export const findTemplateExamplesDescription =
  'Find a ready-to-run Carbone example: when the user wants to try Carbone, needs a starting template, or asks how to ' +
  'build a kind of document (invoice, label, report, contract, e-invoice...) or use a feature (loop, chart, barcode...). ' +
  'Each example is a real template (DOCX, XLSX, PPTX, ODT, HTML, SVG, CSV, XML, IDML...) with its JSON data, the ' +
  'document it produces, and a page explaining its tags. Each comes with renderArguments: pass them, unchanged, to ' +
  'render_document to fill it with its data (converting it is optional). inspect_template on its template URL lists the data it expects; upload_template ' +
  'keeps it in the account to adapt. No argument: the newest examples and the use cases.';

export const findTemplateExamplesSchema = {
  query: z.string().max(200).optional()
    .describe('Keywords, e.g. "invoice barcode", "excel chart", "shipping label", "pdf form".'),
  useCase: z.string().max(100).optional()
    .describe('A use case: finance, logistics, reports, compliance, tickets, planning, presentations, publishing.'),
  templateFormat: z.string().max(10).optional().describe('Template format, e.g. "docx", "xlsx", "html".'),
  resultFormat: z.string().max(10).optional().describe('Generated format, e.g. "pdf", "xlsx", "csv".'),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  kind: z.enum(['gallery', 'format-guide']).optional()
    .describe('"gallery": complete business documents. "format-guide": one feature of one format, for beginners.'),
  id: z.string().max(100).optional().describe('One example, by its id.'),
  limit: z.number().int().min(1).max(25).optional().describe('1 to 25 results (default 8).'),
};

const exampleOutput = z.object({
  id: z.string(), kind: z.enum(['gallery', 'format-guide']), title: z.string(), description: z.string(),
  templateFormat: z.string(), resultFormat: z.string(), resultLabel: z.string().optional(), level: z.string(), useCase: z.string().optional(),
  features: z.array(z.string()), carboneVersion: z.string().optional(), page: z.string(),
  files: z.object({
    template: z.string(), data: z.string().optional(), result: z.string().optional(),
    preview: z.string().optional().describe('An image of the result, to show the user before rendering anything.'),
    translations: z.string().optional(), other: z.array(z.string()).optional(),
  }),
  renderArguments: z.object({ template: z.string(), data: z.string().optional(), translations: z.string().optional() })
    .describe('The render_document arguments that fill this template with its data, to pass as they are: the result keeps the template\'s format.'),
  conversion: z.object({ convertTo: z.string(), converter: z.literal('C').optional() }).optional()
    .describe('Optional, for information: what to add to renderArguments to get the format the example shows (e.g. PDF).'),
});

export const findTemplateExamplesOutputSchema = {
  total: z.number().int().describe('How many examples match (more than listed when above the limit).'),
  examples: z.array(exampleOutput),
};

type Args = { [K in keyof typeof findTemplateExamplesSchema]?: z.infer<(typeof findTemplateExamplesSchema)[K]> };

const STOP_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'with', 'to', 'in', 'on', 'from', 'by', 'template', 'templates', 'example', 'examples']);
/** What people call the formats. */
const FORMAT_NAMES: Record<string, string> = { word: 'docx', excel: 'xlsx', powerpoint: 'pptx', libreoffice: 'odt' };
const words = (value: string) => value.toLowerCase().split(/[^\p{L}\p{N}]+/u)
  .filter((word) => word && !STOP_WORDS.has(word))
  .map((word) => FORMAT_NAMES[word] ?? (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word));

/** How well `example` matches `terms`: the words it matches first, then where (title, keywords and features weigh more). */
function score(example: Example, terms: string[]): [matched: number, weight: number] {
  const fields: Array<[string, number]> = [
    [`${example.title} ${example.id}`, 4], [[...example.keywords, ...example.features].join(' '), 3],
    [`${example.templateFormat} ${example.resultFormat} ${example.resultLabel ?? ''} ${example.useCase ?? ''}`, 2], [example.description, 1],
  ].map(([value, weight]) => [(value as string).toLowerCase(), weight as number]);
  let matched = 0, weight = 0;
  for (const term of terms) {
    const best = Math.max(0, ...fields.filter(([value]) => value.includes(term)).map(([, w]) => w));
    if (best) { matched++; weight += best; }
  }
  return [matched, weight];
}

/** The examples matching `args`, best first: gallery before format guides, new ones first, when nothing ranks them. */
export function findExamples(catalog: Catalog, args: Args): Example[] {
  const is = (value: string | undefined, wanted: string | undefined) => !wanted || value === wanted.trim().toLowerCase().replace(/^\./, '');
  const found = catalog.examples.filter((e) =>
    (!args.id || e.id === args.id) && is(e.useCase, args.useCase) && is(e.templateFormat, args.templateFormat) &&
    (is(e.resultFormat, args.resultFormat) || !!e.resultLabel && is(lower(e.resultLabel), args.resultFormat)) && (!args.level || e.level === args.level) && (!args.kind || e.kind === args.kind));
  const order = (e: Example) => (e.kind === 'gallery' ? 0 : 2) + (e.isNew ? 0 : 1);
  const terms = words(args.query ?? '');
  if (!terms.length) return found.map((e, i) => [e, i] as const).sort(([a, i], [b, j]) => order(a) - order(b) || i - j).map(([e]) => e);
  return found.map((e) => [e, score(e, terms)] as const).filter(([, [matched]]) => matched)
    .sort(([a, [m, w]], [b, [n, v]]) => n - m || v - w || order(a) - order(b)).map(([e]) => e);
}

/** What render_document takes to fill `e`'s template with its data, as is: the result keeps the template's format. */
export function renderArguments(e: Example) {
  return {
    template: e.files.template, ...(e.files.data && { data: e.files.data }),
    ...(e.files.translations && { translations: e.files.translations }),
  };
}

/** Optional: what to add to renderArguments to get the format the example shows, when it differs from the template's. */
export function conversionOf(e: Example) {
  return converts(e) ? { convertTo: e.resultFormat, ...converterOf(e.templateFormat) } : undefined;
}

function describe(e: Example): string {
  const formats = `${e.templateFormat.toUpperCase()} template to ${e.resultFormat.toUpperCase()}${e.resultLabel ? ` (${e.resultLabel})` : ''}`;
  const about = [formats, e.level, e.useCase, e.carboneVersion && `Carbone ${e.carboneVersion}+`, e.features.length && `uses ${e.features.join(', ')}`]
    .filter(Boolean).join(' · ');
  return [
    `### ${e.title} (id: ${e.id})`, e.description, about,
    e.files.other && `- other files: ${e.files.other.join(', ')}`,
    e.files.result && `- expected result: ${e.files.result}`,
    e.files.preview && `- preview of the result (image): ${e.files.preview}`,
    `- renderArguments: ${JSON.stringify(renderArguments(e))}${e.files.translations ? ' (add lang, a language of the translations file, e.g. "fr-fr")' : ''}`,
    conversionOf(e) && `- optional, to get ${e.resultFormat.toUpperCase()} as in the example: add ${JSON.stringify(conversionOf(e))}${iceFaster(e) ? ' (converter "I", Carbone ICE, is faster)' : ''}`,
    `- explained: ${e.page}`,
  ].filter(Boolean).join('\n');
}

const NEXT_STEPS =
  'To generate one: render_document with its renderArguments, unchanged: Carbone fills the template with the data, ' +
  'and the result keeps the template\'s format. A conversion (convertTo) is optional, when the user wants another ' +
  'format; its converter is optional too (default "L", LibreOffice, the widest compatibility): "C" (Chromium) is ' +
  'advised for HTML and SVG templates, "I" (Carbone ICE) is the fastest from DOCX or ODT to PDF. To adapt one: ' +
  'inspect_template on its template URL lists the data it expects.';

export async function handleFindTemplateExamples(args: Args, catalog: ExampleCatalog = exampleCatalog) {
  const loaded = await catalog.get();
  if (!loaded) {
    return {
      content: [{ type: 'text' as const, text: 'The examples catalog is unavailable right now. Browse https://carbone.io/examples/ instead.' }],
      isError: true,
    };
  }
  const found = findExamples(loaded, args);
  const shown = found.slice(0, args.limit ?? 8);
  const filtered = Object.entries(args).some(([key, value]) => key !== 'limit' && value !== undefined);
  const header = !found.length
    ? `No example matches. Try fewer filters or other keywords. Use cases: ${loaded.useCases.map((u) => u.id).join(', ')}. ` +
      `Template formats: ${[...new Set(loaded.examples.map((e) => e.templateFormat))].join(', ')}.`
    : `${found.length} example${found.length > 1 ? 's' : ''} match${found.length > 1 ? '' : 'es'}${shown.length < found.length ? `, ${shown.length} shown` : ''}. ${NEXT_STEPS}`;
  const useCases = filtered ? '' : `\n\nUse cases: ${loaded.useCases.map((u) => `${u.id} (${u.label})`).join(', ')}.`;
  return {
    content: [{ type: 'text' as const, text: [header + useCases, ...shown.map(describe)].join('\n\n') }],
    structuredContent: {
      total: found.length,
      examples: shown.map((e) => {
        const { keywords: _, isNew: __, ...shownFields } = e;
        return { ...shownFields, renderArguments: renderArguments(e), ...(conversionOf(e) && { conversion: conversionOf(e) }) };
      }),
    },
  };
}
