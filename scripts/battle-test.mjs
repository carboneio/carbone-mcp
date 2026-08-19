// Battle test — exercises the FULL Carbone MCP option matrix end-to-end through the real MCP
// protocol against a real Carbone API, with one suite usable across three targets. Self-cleaning.
//
// Usage:
//   set -a; . ./.env; set +a            # loads CARBONE_TEST_API_KEY (or export CARBONE_API_KEY)
//   npm run build
//
//   # local build (dist/index.js) against the PRODUCTION Carbone API — use this to check whether a
//   # new API feature (e.g. the ICE converter) is live on Carbone Cloud before shipping the MCP:
//   CARBONE_API_KEY=$CARBONE_TEST_API_KEY MCP_TARGET=stdio node scripts/battle-test.mjs
//
//   # local build against an on-premise / staging Carbone API:
//   CARBONE_API_KEY=$CARBONE_TEST_API_KEY CARBONE_BASE_URL=https://carbone.acme.internal MCP_TARGET=stdio node scripts/battle-test.mjs
//
//   # a locally running HTTP MCP server:
//   CARBONE_API_KEY=$CARBONE_TEST_API_KEY MCP_TARGET=http node scripts/battle-test.mjs
//
//   # the DEPLOYED production MCP server (https://mcp.carbone.io) — tests what users actually hit,
//   # so it only covers a change once that change has been deployed there:
//   CARBONE_API_KEY=$CARBONE_TEST_API_KEY MCP_TARGET=prod node scripts/battle-test.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const PROD_MCP_URL = 'https://mcp.carbone.io';
const PROD_API_URL = 'https://api.carbone.io';

const TARGET = process.env.MCP_TARGET ?? 'stdio';
const KEY = process.env.CARBONE_API_KEY ?? process.env.CARBONE_TEST_API_KEY;
if (!['stdio', 'http', 'prod'].includes(TARGET)) {
  console.error(`Invalid MCP_TARGET "${TARGET}". Use "stdio", "http", or "prod".`); process.exit(2);
}
const IS_STDIO = TARGET === 'stdio';
if (!KEY) { console.error('Set CARBONE_API_KEY (or CARBONE_TEST_API_KEY).'); process.exit(2); }

// Two independent axes, both worth printing so a run is never ambiguous about what it hit:
//   MCP_URL  — which MCP server is under test (stdio spawns the local build instead).
//   API_URL  — which Carbone API that server talks to. We only control it in stdio mode; for a
//              remote MCP server it is whatever that deployment was configured with.
const MCP_URL = process.env.MCP_URL ?? (TARGET === 'prod' ? PROD_MCP_URL : 'http://localhost:3000');
// Which server entry stdio spawns. Defaults to the local build; point it at an installed package
// (…/node_modules/carbone-mcp/dist/index.js) to battle-test the PUBLISHED tarball — the working tree
// and the packed artifact are not the same thing, and `files`/build config can diverge between them.
const MCP_BIN = process.env.MCP_BIN ?? 'dist/index.js';
const API_URL = IS_STDIO ? (process.env.CARBONE_BASE_URL ?? PROD_API_URL) : null;
// A remote MCP is assumed to be pointed at a real account; in stdio we know for sure.
const HITS_PROD_API = IS_STDIO ? API_URL === PROD_API_URL : true;

async function makeTransport() {
  if (IS_STDIO) {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    return new StdioClientTransport({ command: 'node', args: [MCP_BIN], env: { ...process.env, CARBONE_API_KEY: KEY } });
  }
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  return new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers: { Authorization: `Bearer ${KEY}` } } });
}

const b64 = (s) => Buffer.from(s).toString('base64');
const INV = b64('<!DOCTYPE html><html><body><h1>Invoice for {d.customer}</h1><p>Total: {d.total:formatN(2)} EUR</p></body></html>');
const TRANS = b64('<!DOCTYPE html><html><body><p>{t(hi)}, {d.name}! {d.status:convEnum(ST)}</p></body></html>');
const COMP = b64('<!DOCTYPE html><html><body><p>{c.company} — {d.x}</p></body></html>');
const CUR = b64('<!DOCTYPE html><html><body>{d.p:formatC()}</body></html>');
const DATE = b64('<!DOCTYPE html><html><body>{d.d:formatD(YYYY-MM-DD)}</body></html>');

let pass = 0, fail = 0;
const created = [];
const text = (r) => r.content?.find((c) => c.type === 'text')?.text ?? '';
const c0 = (r) => r.content?.[0];
const typeOf = (r) => c0(r)?.type;
const mimeOf = (r) => c0(r)?.resource?.mimeType ?? '';
const uriOf = (r) => c0(r)?.resource?.uri ?? '';
// Binary docs (PDF, Office, …) are delivered per-transport: stdio saves to a temp file and returns a
// text result (path + byte count); HTTP returns the bytes as an attachment (EmbeddedResource).
const savedToFile = (r) => typeOf(r) === 'text' && /saved to/i.test(text(r)) && /bytes/i.test(text(r));
const isBinaryDoc = (r, mimeMatch) => IS_STDIO ? savedToFile(r) : (typeOf(r) === 'resource' && mimeOf(r).includes(mimeMatch));
const isPdf = (r) => isBinaryDoc(r, 'application/pdf');
// returnLink → inline text carrying the public one-time /render/{renderId} URL + a one-time warning.
const isOneTimeLink = (r) => typeOf(r) === 'text' && /\/render\//.test(text(r)) && /ONCE/.test(text(r));
const blobOf = (r) => c0(r)?.resource?.blob ?? '';
// First line of a tool's text result — the API's error message on failure, worth printing next to a ✗.
const why = (r) => (r.isError ? '→ ' + text(r).split('\n')[0].slice(0, 110) : '');
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? '  ' + extra : ''}`); }
}
// Informational only — neither passes nor fails. Used where we are probing undocumented behaviour
// (e.g. what a converter does with an input format it does not claim to support) and asserting an
// outcome would bake a guess into the suite.
function note(label, detail) { console.log(`  · ${label}${detail ? '  ' + detail : ''}`); }
let CLIENT;
const call = (name, args) => CLIENT.callTool({ name, arguments: args }).catch((e) => ({ isError: true, content: [{ type: 'text', text: e.message }] }));
function track(r) { const s = r.structuredContent ?? {}; const k = s.id ?? s.templateId ?? s.versionId; if (k) created.push(k); return s; }

async function run() {
  console.log(`\n=== Battle test (full matrix) — target=${TARGET} ===`);
  console.log(`    MCP server : ${IS_STDIO ? MCP_BIN : MCP_URL}`);
  console.log(`    Carbone API: ${API_URL ?? 'whatever the remote MCP server is configured with'}`);
  if (HITS_PROD_API) {
    console.log('    ⚠  Real Carbone account: this run uploads ~4 templates and bills real renders,');
    console.log('       then deletes every template it created. Ctrl-C now to abort.');
  }
  CLIENT = new Client({ name: 'battle-test', version: '0' });
  await CLIENT.connect(await makeTransport());

  try {
    // ── handshake + discovery ──────────────────────────────────────────────────
    const info = CLIENT.getServerVersion(), caps = CLIENT.getServerCapabilities();
    check('serverInfo.title = Carbone', info?.title === 'Carbone');
    check('icons advertised (svg + png)', (info?.icons?.length ?? 0) === 2);
    check('capabilities tools/resources/completions', !!caps?.tools && !!caps?.resources && !!caps?.completions);
    check('instructions present', !!CLIENT.getInstructions?.());
    const { tools } = await CLIENT.listTools();
    check('11 tools, titles, annotations, outputSchema', tools.length === 11
      && tools.find((t) => t.name === 'convert_document')?.title === 'Convert Document'
      && tools.find((t) => t.name === 'delete_template')?.annotations?.destructiveHint === true
      && !!tools.find((t) => t.name === 'list_templates')?.outputSchema);
    check('4 static resources + templates/{id}', (await CLIENT.listResources()).resources.length === 4
      && (await CLIENT.listResourceTemplates()).resourceTemplates.some((r) => r.uriTemplate === 'carbone://templates/{id}'));

    // ── info ─────────────────────────────────────────────────────────────────────
    console.log('\n[info]');
    check('get_api_status structuredContent.version', typeof (await call('get_api_status', {})).structuredContent?.version === 'string');
    check('get_capabilities overview', text(await call('get_capabilities', {})).includes('Carbone'));

    // ── convert: converters × formatOptions × outputs × delivery ──────────────────
    console.log('\n[convert_document]');
    for (const conv of ['L', 'C', 'O']) check(`converter ${conv} → PDF`, isPdf(await call('convert_document', { file: INV, convertTo: 'pdf', converter: conv })));
    check('formatOptions watermark', isPdf(await call('convert_document', { file: INV, convertTo: { formatName: 'pdf', formatOptions: { Watermarks: [{ text: 'DRAFT', opacity: 0.2 }] } }, converter: 'C' })));
    check('formatOptions password', isPdf(await call('convert_document', { file: INV, convertTo: { formatName: 'pdf', formatOptions: { EncryptFile: true, DocumentOpenPassword: 's' } }, converter: 'C' })));
    check('formatOptions PDF/A', isPdf(await call('convert_document', { file: INV, convertTo: { formatName: 'pdf', formatOptions: { SelectPdfVersion: 1 } }, converter: 'C' })));
    check('→ DOCX', isBinaryDoc(await call('convert_document', { file: INV, convertTo: 'docx' }), 'officedocument'));
    check('→ TXT inline text', typeOf(await call('convert_document', { file: INV, convertTo: 'txt' })) === 'text');
    check('→ TXT asAttachment = resource', mimeOf(await call('convert_document', { file: INV, convertTo: 'txt', asAttachment: true })) === 'text/plain');
    check('returnLink → one-time download URL', isOneTimeLink(await call('convert_document', { file: INV, convertTo: 'pdf', converter: 'C', returnLink: true })));
    check('bad converter rejected (validation)', (await call('convert_document', { file: INV, convertTo: 'pdf', converter: 'X' })).isError === true);
    // Carbone reads XML/text-based documents only. A legacy binary .doc is rejected as INPUT (w118) even
    // though Carbone can produce one as output — build a real .doc here and assert it still bounces, so a
    // change on Carbone's side shows up rather than quietly making the format docs wrong again.
    const docBin = blobOf(await call('convert_document', { file: INV, convertTo: 'doc', asAttachment: true }));
    if (docBin) {
      const docIn = await call('convert_document', { file: docBin, convertTo: 'pdf' });
      check('legacy binary .doc rejected as input', docIn.isError === true && /not supported/i.test(text(docIn)), why(docIn));
    } else {
      note('legacy .doc fixture', 'could not be produced — skipped');
    }
    // Conversion must NOT template: the API only skips the templating pass when `data` is absent from
    // the body. Sending data:{} instead would blank every tag, so this asserts the tags come back literal.
    const cKeep = await call('convert_document', { file: INV, convertTo: 'html' });
    check('preserves Carbone tags (no templating)', text(cKeep).includes('{d.customer}') && text(cKeep).includes('{d.total:formatN(2)}'), why(cKeep));
    check('reportName', /bt-conv/.test(IS_STDIO ? text(await call('convert_document', { file: INV, convertTo: 'pdf', converter: 'C', reportName: 'bt-conv' })) : uriOf(await call('convert_document', { file: INV, convertTo: 'pdf', converter: 'C', reportName: 'bt-conv' }))));
    check('hardRefresh PDF → PDF applies formatOptions', isPdf(await call('convert_document', { file: INV, convertTo: { formatName: 'pdf', formatOptions: { Watermarks: [{ text: 'X', opacity: 0.2 }] } }, converter: 'C', hardRefresh: true })));
    const cOut = await call('convert_document', { file: INV, convertTo: 'pdf', converter: 'C', outputPath: `/tmp/bt-c-${Date.now()}.pdf` });
    check(IS_STDIO ? 'outputPath writes (stdio)' : 'outputPath rejected (HTTP)', IS_STDIO ? text(cOut).includes('bytes') : (cOut.isError && text(cOut).includes('stdio')));

    // ── converter I (Carbone ICE, API 5.14.0+) ────────────────────────────────────
    // ICE is DOCX → PDF only, so it cannot reuse the HTML fixtures above. Rather than commit a
    // binary .docx to the repo, build one with Carbone itself: HTML → DOCX with asAttachment forces
    // an EmbeddedResource (base64 blob) on BOTH transports, and the {d.…} tags survive as plain text,
    // so the same bytes work as a convert input AND as a render template.
    console.log('\n[converter I — Carbone ICE]');
    const docxRes = await call('convert_document', { file: INV, convertTo: 'docx', asAttachment: true });
    const DOCX = blobOf(docxRes);
    check('DOCX fixture built (HTML → DOCX)', DOCX.length > 0, why(docxRes));
    if (DOCX) {
      const iceC = await call('convert_document', { file: DOCX, convertTo: 'pdf', converter: 'I' });
      check('convert DOCX → PDF, converter I', isPdf(iceC), why(iceC));
      const iceR = await call('render_document', { template: DOCX, data: { customer: 'Ice', total: 42 }, convertTo: 'pdf', converter: 'I' });
      check('render DOCX → PDF, converter I', isPdf(iceR), why(iceR));
      const iceLink = await call('convert_document', { file: DOCX, convertTo: 'pdf', converter: 'I', returnLink: true });
      check('converter I + returnLink', isOneTimeLink(iceLink), why(iceLink));
      // Documented ICE limitation, and a security-relevant one: password/permission options are accepted
      // but never applied. Asserted so that the day Carbone starts honouring them, this suite says so and
      // the "use L for passwords" warnings in the tool descriptions can be revisited.
      const iceEnc = await call('convert_document', { file: DOCX, convertTo: { formatName: 'pdf', formatOptions: { EncryptFile: true, DocumentOpenPassword: 's3cret' } }, converter: 'I', asAttachment: true });
      const iceEncrypted = Buffer.from(blobOf(iceEnc), 'base64').includes('/Encrypt');
      check('converter I ignores PDF encryption (documented footgun)', !iceEncrypted && blobOf(iceEnc).length > 0, iceEncrypted ? '→ NOW ENCRYPTED: docs/descriptions need updating' : '');
      // ICE claims DOCX only. Carbone may reject a non-DOCX input or quietly fall back to another
      // engine — undocumented either way, so record what this deployment actually did.
      const iceHtml = await call('convert_document', { file: INV, convertTo: 'pdf', converter: 'I' });
      note('converter I on HTML input (DOCX-only engine)', iceHtml.isError ? `rejected ${why(iceHtml)}` : 'accepted — produced a PDF');
    }

    // ── render: every option ──────────────────────────────────────────────────────
    console.log('\n[render_document]');
    check('data injection', text(await call('render_document', { template: INV, data: { customer: 'Acme', total: 1700 }, convertTo: 'html' })).includes('Acme'));
    check('data as inline JSON string (parsed)', text(await call('render_document', { template: INV, data: '{"customer":"AcmeStr","total":1}', convertTo: 'html' })).includes('AcmeStr'));
    // The two "no data" modes are opposites and both must be exercised: omitted data renders against an
    // empty dataset (tags → ''), keepTags omits the field from the body so templating never runs.
    const rEmpty = await call('render_document', { template: INV, convertTo: 'html' });
    check('no data → tags resolve to empty', !text(rEmpty).includes('{d.customer}'), why(rEmpty));
    const rKeep = await call('render_document', { template: INV, convertTo: 'html', keepTags: true });
    check('keepTags → tags left literal', text(rKeep).includes('{d.customer}'), why(rKeep));
    check('keepTags + data rejected', (await call('render_document', { template: INV, data: { customer: 'A' }, keepTags: true })).isError === true);
    check('data as top-level array ({d[i]})', text(await call('render_document', { template: b64('<!DOCTYPE html><html><body><ul><li>{d[i].n}</li><li>{d[i+1].n}</li></ul></body></html>'), data: [{ n: 'A1' }, { n: 'B2' }], convertTo: 'html' })).includes('A1'));
    check('→ PDF', isPdf(await call('render_document', { template: INV, data: { customer: 'A', total: 1 }, convertTo: 'pdf', converter: 'C' })));
    check('→ DOCX', isBinaryDoc(await call('render_document', { template: INV, data: { customer: 'A', total: 1 }, convertTo: 'docx' }), 'officedocument'));
    check('lang + translations', text(await call('render_document', { template: TRANS, data: { name: 'Al', status: '1' }, convertTo: 'html', lang: 'fr-fr', translations: { 'fr-fr': { hi: 'Bonjour' }, 'en-us': { hi: 'Hello' } }, enum: { ST: { 1: 'Actif' } } })).includes('Bonjour'));
    check('enum convEnum', text(await call('render_document', { template: TRANS, data: { name: 'Al', status: '1' }, convertTo: 'html', enum: { ST: { 1: 'Actif' } } })).includes('Actif'));
    check('currency formatC conversion', /\$|USD/.test(text(await call('render_document', { template: CUR, data: { p: 100 }, convertTo: 'html', currencySource: 'EUR', currencyTarget: 'USD', currencyRates: { EUR: 1, USD: 1.1 } }))));
    check('complement {c.}', text(await call('render_document', { template: COMP, data: { x: 1 }, convertTo: 'html', complement: { company: 'Acme' } })).includes('Acme'));
    check('variableStr (no error)', !(await call('render_document', { template: INV, data: { customer: 'A', total: 1 }, convertTo: 'html', variableStr: '{#z = d.total}' })).isError);
    check('timezone formatD (no error)', !(await call('render_document', { template: DATE, data: { d: '2026-01-15T10:00:00Z' }, convertTo: 'html', timezone: 'Europe/Paris' })).isError);
    check('hardRefresh (no error)', !(await call('render_document', { template: INV, data: { customer: 'A', total: 1 }, convertTo: 'pdf', hardRefresh: true })).isError);
    const rRep = await call('render_document', { template: INV, data: { customer: 'A', total: 1 }, convertTo: 'pdf', converter: 'C', reportName: 'bt-invoice' });
    check('reportName (no ext) → filename', IS_STDIO ? (savedToFile(rRep) && /bt-invoice/.test(text(rRep))) : uriOf(rRep).includes('bt-invoice'));
    check('asAttachment = resource', typeOf(await call('render_document', { template: INV, data: { customer: 'A', total: 1 }, convertTo: 'html', asAttachment: true })) === 'resource');
    check('returnLink → one-time download URL', isOneTimeLink(await call('render_document', { template: INV, data: { customer: 'A', total: 1 }, convertTo: 'pdf', converter: 'C', returnLink: true })));
    check('webhook async message', /callback|render/i.test(text(await call('render_document', { template: INV, data: { customer: 'A', total: 1 }, convertTo: 'pdf', webhookUrl: 'https://example.com/hook' }))));
    check('batch async message (zip)', /callback|render/i.test(text(await call('render_document', { template: INV, data: { items: [{ x: 1 }, { x: 2 }] }, convertTo: 'pdf', batchSplitBy: 'd.items', batchOutput: 'zip', webhookUrl: 'https://example.com/hook' }))));
    check('batch concatenated PDF (batchOutput: "pdf")', /callback|render/i.test(text(await call('render_document', { template: INV, data: { items: [{ x: 1 }, { x: 2 }] }, convertTo: 'pdf', batchSplitBy: 'd.items', batchOutput: 'pdf', webhookUrl: 'https://example.com/hook' }))));
    check('batch splitBy "d" (data IS the array)', /callback|render/i.test(text(await call('render_document', { template: INV, data: [{ customer: 'A', total: 1 }, { customer: 'B', total: 2 }], convertTo: 'pdf', batchSplitBy: 'd', batchOutput: 'zip', webhookUrl: 'https://example.com/hook' }))));
    check('batchOutput "pdf" without convertTo pdf rejected', (await call('render_document', { template: INV, data: { items: [{ x: 1 }] }, convertTo: 'docx', batchSplitBy: 'd.items', batchOutput: 'pdf', webhookUrl: 'https://example.com/hook' })).isError === true);
    check('invalid batchOutput rejected (enum)', (await call('render_document', { template: INV, data: { items: [{ x: 1 }] }, convertTo: 'pdf', batchSplitBy: 'd.items', batchOutput: 'tar', webhookUrl: 'https://example.com/hook' })).isError === true);
    check('XOR both rejected', (await call('render_document', { templateId: 'x', template: INV, data: {} })).isError === true);
    check('XOR neither rejected', (await call('render_document', { data: {} })).isError === true);
    const rOut = await call('render_document', { template: INV, data: { customer: 'S', total: 1 }, convertTo: 'pdf', converter: 'C', outputPath: `/tmp/bt-r-${Date.now()}.pdf` });
    check(IS_STDIO ? 'outputPath writes (stdio)' : 'outputPath rejected (HTTP)', IS_STDIO ? text(rOut).includes('bytes') : (rOut.isError && text(rOut).includes('stdio')));

    // ── upload matrix ──────────────────────────────────────────────────────────────
    console.log('\n[upload_template]');
    const upV = track(await call('upload_template', { template: INV, name: `BattleTest-ver ${Date.now()}`, category: 'bt-cat', tags: ['bt'], comment: 'battle', versioning: true }));
    const id = upV.id, versionId = upV.versionId;
    check('versioning=true → id + versionId', typeof id === 'string' && typeof versionId === 'string');
    const upL = track(await call('upload_template', { template: INV, name: `BattleTest-leg ${Date.now()}`, versioning: false }));
    check('versioning=false → templateId', typeof upL.templateId === 'string');
    const upS = track(await call('upload_template', { template: INV, name: `BattleTest-sample ${Date.now()}`, versioning: true, sample: [{ data: { customer: 'SAMPLE-X' }, complement: {}, translations: {}, enum: {} }] }));
    check('with sample', !!upS.id);
    check('with deployedAt (NOW sentinel)', !!track(await call('upload_template', { template: INV, name: `BattleTest-dep ${Date.now()}`, versioning: true, deployedAt: 42000000000 })).id);

    // ── list filters ────────────────────────────────────────────────────────────────
    console.log('\n[list_templates filters]');
    check('by category', (await call('list_templates', { category: 'bt-cat' })).structuredContent?.templates.length > 0);
    check('by search', (await call('list_templates', { search: 'BattleTest-ver' })).structuredContent?.templates.some((t) => (t.name ?? '').includes('BattleTest-ver')));
    check('by id', (await call('list_templates', { id })).structuredContent?.templates.length > 0);
    check('includeVersions', Array.isArray((await call('list_templates', { id, includeVersions: true })).structuredContent?.templates));
    check('origin filter', Array.isArray((await call('list_templates', { origin: 0 })).structuredContent?.templates));
    const p1 = (await call('list_templates', { limit: 1 })).structuredContent;
    let cur = true; if (p1?.hasMore && p1?.nextCursor) cur = Array.isArray((await call('list_templates', { limit: 1, cursor: p1.nextCursor })).structuredContent?.templates);
    check('limit + cursor pagination', cur);
    check('limit=101 rejected (max 100)', (await call('list_templates', { limit: 101 })).isError === true);
    check('list_categories includes bt-cat', (await call('list_categories', {})).structuredContent?.categories.includes('bt-cat'));
    check('list_tags includes bt', (await call('list_tags', {})).structuredContent?.tags.includes('bt'));

    // ── render by id / versionId, download, update, resources, completion ────────────
    console.log('\n[stored-template ops]');
    check('render by templateId', text(await call('render_document', { templateId: id, data: { customer: 'ById', total: 5 }, convertTo: 'html' })).includes('ById'));
    check('render by versionId', text(await call('render_document', { templateId: versionId, data: { customer: 'ByVer', total: 5 }, convertTo: 'html' })).includes('ByVer'));
    check('download by id', !(await call('download_template', { templateId: id })).isError);
    check('download by versionId', !(await call('download_template', { templateId: versionId })).isError);
    check('download asAttachment = resource', typeOf(await call('download_template', { templateId: id, asAttachment: true })) === 'resource');
    const dOut = await call('download_template', { templateId: id, outputPath: `/tmp/bt-d-${Date.now()}.html` });
    check(IS_STDIO ? 'download outputPath writes (stdio)' : 'download outputPath rejected (HTTP)', IS_STDIO ? text(dOut).includes('bytes') : dOut.isError === true);
    check('update name+category+tags', !(await call('update_template_metadata', { templateId: id, name: 'BattleTest updated', category: 'bt-cat2', tags: ['bt', 'upd'] })).isError);
    check('update deployedAt', !(await call('update_template_metadata', { templateId: id, deployedAt: 42000000000 })).isError);
    // GET /template/{id}_sample.json — the sample dataset stored at upload, readable back as JSON.
    const smp = await call('download_template', { templateId: upS.id, sample: true });
    check('download sample dataset (JSON, inline)', typeOf(smp) === 'text' && text(smp).includes('SAMPLE-X'), why(smp));
    check('sample on a template without one → isError', (await call('download_template', { templateId: upL.templateId, sample: true })).isError === true);

    console.log('\n[resources]');
    // Direct access by id (render/download/delete) is immediate, but the list/search index that the
    // by-id resource read and completion rely on lags briefly for just-created templates — retry.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const readRes = async (label, uri, mustInclude) => {
      let txt = '', err = '';
      for (let i = 0; i < 8; i++) {
        try { txt = (await CLIENT.readResource({ uri })).contents?.[0]?.text ?? ''; err = ''; }
        catch (e) { err = e.message.slice(0, 50); }
        if (mustInclude ? txt.includes(mustInclude) : (txt || !err)) break;
        await sleep(700);
      }
      check(label, mustInclude ? txt.includes(mustInclude) : !!txt, err);
    };
    await readRes('carbone://templates (browse)', 'carbone://templates');
    await readRes('carbone://templates/{id}', `carbone://templates/${id}`, id);
    await readRes('carbone://templates/{versionId}', `carbone://templates/${versionId}`, versionId);
    await readRes('carbone://categories', 'carbone://categories');
    await readRes('carbone://tags', 'carbone://tags');
    await readRes('carbone://status', 'carbone://status');
    let comp = { completion: { values: [] } };
    for (let i = 0; i < 8; i++) {
      comp = await CLIENT.complete({ ref: { type: 'ref/resource', uri: 'carbone://templates/{id}' }, argument: { name: 'id', value: id.slice(0, 6) } }).catch(() => ({ completion: { values: [] } }));
      if (!IS_STDIO || comp.completion.values.includes(id)) break;
      await sleep(700);
    }
    const vals = comp.completion.values;
    if (IS_STDIO) {
      check('completion returns the id (stdio)', vals.includes(id), `(${vals.length})`);
    } else {
      // Completion callbacks receive no auth token (the SDK type has no authInfo), so completeTemplateId
      // can only use the server's constructor-level key. An HTTP server started WITHOUT one returns []
      // and one started WITH one returns ids — both correct, and the harness cannot know which it is
      // talking to. Assert what holds either way: no error, and every suggestion is a real prefix match.
      const prefix = id.slice(0, 6);
      check('completion valid for this server\'s key config (HTTP)',
        Array.isArray(vals) && vals.every((v) => typeof v === 'string' && v.startsWith(prefix)),
        vals.length ? `${vals.length} suggestion(s) — server has its own key` : 'none — server has no key of its own');
    }

    console.log('\n[errors]');
    check('missing template → isError', (await call('render_document', { templateId: 'does-not-exist', data: {} })).isError === true);
    check('delete non-existent → isError', (await call('delete_template', { templateId: 'nope-not-real' })).isError === true);
  } finally {
    // ── cleanup: delete everything we created ───────────────────────────────────────
    console.log('\n[cleanup]');
    const seen = new Set();
    for (const k of created) {
      if (seen.has(k)) continue; seen.add(k);
      const d = await call('delete_template', { templateId: k });
      check(`delete ${k}`, !d.isError);
    }
    await CLIENT.close();
  }

  console.log(`\n=== ${pass} passed, ${fail} failed (target=${TARGET}) ===`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });
