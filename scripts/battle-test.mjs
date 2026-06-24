// Battle test — exercises the FULL Carbone MCP option matrix end-to-end through the real MCP
// protocol against a real Carbone API, with one suite usable across three targets. Self-cleaning.
//
// Usage:
//   set -a; . ./.env; set +a            # loads CARBONE_TEST_API_KEY (or export CARBONE_API_KEY)
//   npm run build
//   CARBONE_API_KEY=$CARBONE_TEST_API_KEY MCP_TARGET=stdio node scripts/battle-test.mjs
//   CARBONE_API_KEY=$CARBONE_TEST_API_KEY MCP_TARGET=http MCP_URL=http://localhost:3000 node scripts/battle-test.mjs
//   CARBONE_API_KEY=$CARBONE_TEST_API_KEY MCP_TARGET=http MCP_URL=https://mcp.carbone.io node scripts/battle-test.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const TARGET = process.env.MCP_TARGET ?? 'stdio';
const KEY = process.env.CARBONE_API_KEY ?? process.env.CARBONE_TEST_API_KEY;
const IS_STDIO = TARGET !== 'http';
if (!KEY) { console.error('Set CARBONE_API_KEY (or CARBONE_TEST_API_KEY).'); process.exit(2); }

async function makeTransport() {
  if (IS_STDIO) {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    return new StdioClientTransport({ command: 'node', args: ['dist/index.js'], env: { ...process.env, CARBONE_API_KEY: KEY } });
  }
  const url = process.env.MCP_URL ?? 'http://localhost:3000';
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  return new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${KEY}` } } });
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
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? '  ' + extra : ''}`); }
}
let CLIENT;
const call = (name, args) => CLIENT.callTool({ name, arguments: args }).catch((e) => ({ isError: true, content: [{ type: 'text', text: e.message }] }));
function track(r) { const s = r.structuredContent ?? {}; const k = s.id ?? s.templateId ?? s.versionId; if (k) created.push(k); return s; }

async function run() {
  console.log(`\n=== Battle test (full matrix) — target=${TARGET}${IS_STDIO ? '' : ' url=' + (process.env.MCP_URL ?? 'http://localhost:3000')} ===`);
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
    const cOut = await call('convert_document', { file: INV, convertTo: 'pdf', converter: 'C', outputPath: `/tmp/bt-c-${Date.now()}.pdf` });
    check(IS_STDIO ? 'outputPath writes (stdio)' : 'outputPath rejected (HTTP)', IS_STDIO ? text(cOut).includes('bytes') : (cOut.isError && text(cOut).includes('stdio')));

    // ── render: every option ──────────────────────────────────────────────────────
    console.log('\n[render_document]');
    check('data injection', text(await call('render_document', { template: INV, data: { customer: 'Acme', total: 1700 }, convertTo: 'html' })).includes('Acme'));
    check('data as inline JSON string (parsed)', text(await call('render_document', { template: INV, data: '{"customer":"AcmeStr","total":1}', convertTo: 'html' })).includes('AcmeStr'));
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
    check('batch async message', /callback|render/i.test(text(await call('render_document', { template: INV, data: { items: [{ x: 1 }, { x: 2 }] }, convertTo: 'pdf', batchSplitBy: 'd.items', batchOutput: 'zip', webhookUrl: 'https://example.com/hook' }))));
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
    check('with sample', !!track(await call('upload_template', { template: INV, name: `BattleTest-sample ${Date.now()}`, versioning: true, sample: [{ data: { customer: 'x' }, complement: {}, translations: {}, enum: {} }] })).id);
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
    if (IS_STDIO) check('completion returns the id (stdio)', comp.completion.values.includes(id), `(${comp.completion.values.length})`);
    else check('completion degrades to [] (HTTP)', comp.completion.values.length === 0);

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
