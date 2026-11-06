import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';

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
//   # a deployed server before it reaches production (staging): its MCP URL, and an OAuth access token when it
//   # runs in OAuth mode (an API key otherwise). Upload URLs and async renders are tested when the server offers
//   # them (MCP_TICKET_SECRET, and MCP_S3_* or MCP_JOBS_DIR): the run header says which it found.
//   MCP_URL=<MCP URL> MCP_ACCESS_TOKEN=<access token> MCP_TARGET=http node scripts/battle-test.mjs
//
//   # the DEPLOYED production MCP server (https://mcp.carbone.io) — tests what users actually hit,
//   # so it only covers a change once that change has been deployed there. It accepts sign-in only (no API
//   # key): pass an OAuth access token issued to a signed-in MCP client:
//   MCP_ACCESS_TOKEN=<access token> MCP_TARGET=prod node scripts/battle-test.mjs

const PROD_MCP_URL = 'https://mcp.carbone.io';
const PROD_API_URL = 'https://api.carbone.io';

const TARGET = process.env.MCP_TARGET ?? 'stdio';
// The prod server is OAuth-only, so it takes an access token; another remote server one too in OAuth mode, or a
// Carbone API key; stdio a Carbone API key.
const KEY = TARGET === 'prod' ? process.env.MCP_ACCESS_TOKEN
  : (TARGET === 'http' && process.env.MCP_ACCESS_TOKEN) || process.env.CARBONE_API_KEY || process.env.CARBONE_TEST_API_KEY;
if (!['stdio', 'http', 'prod'].includes(TARGET)) {
  console.error(`Invalid MCP_TARGET "${TARGET}". Use "stdio", "http", or "prod".`); process.exit(2);
}
const IS_STDIO = TARGET === 'stdio';
if (!KEY) { console.error(TARGET === 'prod' ? 'Set MCP_ACCESS_TOKEN.' : 'Set CARBONE_API_KEY (or CARBONE_TEST_API_KEY), or MCP_ACCESS_TOKEN for an OAuth server.'); process.exit(2); }

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
    const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
    return new StdioClientTransport({ command: 'node', args: [MCP_BIN], env: { ...process.env, CARBONE_API_KEY: KEY } });
  }
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
  return new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers: { Authorization: `Bearer ${KEY}` } } });
}

const b64 = (s) => Buffer.from(s).toString('base64');
const INV = b64('<!DOCTYPE html><html><body><h1>Invoice for {d.customer}</h1><p>Total: {d.total:formatN(2)} EUR</p></body></html>');
const TRANS = b64('<!DOCTYPE html><html><body><p>{t(hi)}, {d.name}! {d.status:convEnum(ST)}</p></body></html>');
const COMP = b64('<!DOCTYPE html><html><body><p>{c.company} — {d.x}</p></body></html>');
const CUR = b64('<!DOCTYPE html><html><body>{d.p:formatC()}</body></html>');
const DATE = b64('<!DOCTYPE html><html><body>{d.d:formatD(YYYY-MM-DD)}</body></html>');
const INSPECT = b64('<!DOCTYPE html><html><body><h1>{d.name}</h1><ul><li>{d.items[i].x}</li><li>{d.items[i+1].x}</li></ul></body></html>');
// An image that can never be downloaded: .test is a reserved TLD, so the host does not resolve (ENOTFOUND).
const BROKEN_IMG = b64('<!DOCTYPE html><html><body><h1>{d.customer}</h1><img src="https://example.test/missing.png" alt="x"></body></html>');
const SVG = b64('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#0099ff"/><text x="10" y="60" font-size="24">{d.customer}</text></svg>');

let pass = 0, fail = 0;
const created = [];
const text = (r) => r.content?.find((c) => c.type === 'text')?.text ?? '';
const c0 = (r) => r.content?.[0];
const typeOf = (r) => c0(r)?.type;
const mimeOf = (r) => c0(r)?.resource?.mimeType ?? '';
const uriOf = (r) => c0(r)?.resource?.uri ?? '';
// returnLink → inline text carrying the public one-time /render/{renderId} URL + a one-time warning.
const isOneTimeLink = (r) => typeOf(r) === 'text' && /\/render\//.test(text(r)) && /ONCE/.test(text(r));
const linkOf = (r) => text(r).match(/https?:\/\/\S+\/render\/\S+/)?.[0] ?? '';
// Binary docs (PDF, Office, …) are delivered per-transport: stdio saves to a temp file and returns a text
// result (path + byte count); HTTP returns a one-time download link by default, or the bytes as an attachment
// (EmbeddedResource) with asAttachment.
const savedToFile = (r) => typeOf(r) === 'text' && /saved to/i.test(text(r)) && /bytes/i.test(text(r));
const isBinaryDoc = (r, mimeMatch, format) => IS_STDIO ? savedToFile(r)
  : isOneTimeLink(r) ? text(r).startsWith(`Generated ${format}.`) : (typeOf(r) === 'resource' && mimeOf(r).includes(mimeMatch));
const isPdf = (r) => isBinaryDoc(r, 'application/pdf', 'pdf');
// One GET of a one-time link: the status, the filename header and the bytes. The link is consumed.
async function download(url) {
  const res = await fetch(url).catch((e) => ({ status: 0, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0), error: e.message }));
  return { status: res.status, disposition: res.headers.get('content-disposition') ?? '', body: Buffer.from(await res.arrayBuffer()) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const blobOf = (r) => c0(r)?.resource?.blob ?? '';
// png/jpg/webp are returned inline as an image block on both transports (the "see the result" path).
const isImage = (r, mime) => typeOf(r) === 'image' && c0(r)?.mimeType === mime;
// Pixel size of an inline image result, read from the PNG IHDR or the WebP VP8X/VP8/VP8L header.
function imageSize(r) {
  const b = Buffer.from(c0(r)?.data ?? '', 'base64');
  if (b.subarray(1, 4).toString() === 'PNG') return [b.readUInt32BE(16), b.readUInt32BE(20)];
  const chunk = b.subarray(12, 16).toString();
  if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1]; }
  return [0, 0];
}
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
    console.log('    ⚠  Real Carbone account: this run uploads ~6 templates and bills real renders,');
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
    // Upload URLs (MCP_TICKET_SECRET) and async renders (and a job store) are HTTP options of the deployment:
    // read from tools/list, and printed, so a run says which it covered.
    const props = (name) => tools.find((t) => t.name === name)?.inputSchema?.properties ?? {};
    const UPLOAD_URLS = 'requestUploadUrl' in props('upload_template');
    const ASYNC = 'async' in props('render_document');
    console.log(`    Upload URLs: ${UPLOAD_URLS ? 'on' : 'off'}    Async renders: ${ASYNC ? 'on' : 'off'}`);
    check(ASYNC ? '13 tools (get_render_result: async renders on), titles, annotations, outputSchema' : '12 tools, titles, annotations, outputSchema',
      tools.length === (ASYNC ? 13 : 12) && tools.some((t) => t.name === 'get_render_result') === ASYNC
      && tools.find((t) => t.name === 'convert_document')?.title === 'Convert Document'
      && tools.find((t) => t.name === 'delete_template')?.annotations?.destructiveHint === true
      && !!tools.find((t) => t.name === 'list_templates')?.outputSchema
      && tools.find((t) => t.name === 'inspect_template')?.annotations?.readOnlyHint === true
      && !!tools.find((t) => t.name === 'inspect_template')?.outputSchema);
    check('4 static resources + templates/{id}', (await CLIENT.listResources()).resources.length === 4
      && (await CLIENT.listResourceTemplates()).resourceTemplates.some((r) => r.uriTemplate === 'carbone://templates/{id}'));
    // ChatGPT hands a chat attachment to the input named in _meta["openai/fileParams"]. Offered over HTTP
    // only: a stdio client passes a local path instead, so there the field and the _meta must be absent.
    const fileParams = (name) => tools.find((t) => t.name === name)?._meta?.['openai/fileParams'];
    const hasInput = (name, field) => !!tools.find((t) => t.name === name)?.inputSchema?.properties?.[field];
    const attachedBy = { convert_document: 'attachedFile', render_document: 'attachedTemplate', inspect_template: 'attachedTemplate', upload_template: 'attachedTemplate' };
    check(IS_STDIO ? 'ChatGPT attachments not offered (stdio)' : 'ChatGPT attachments: _meta openai/fileParams + input on 4 tools (HTTP)',
      Object.entries(attachedBy).every(([name, field]) => IS_STDIO
        ? fileParams(name) === undefined && !hasInput(name, field)
        : JSON.stringify(fileParams(name)) === JSON.stringify([field]) && hasInput(name, field))
      && !hasInput('download_template', 'attachedTemplate') && fileParams('list_templates') === undefined);
    if (IS_STDIO) check('stdio: no upload URLs, no async renders', !UPLOAD_URLS && !ASYNC);
    // The deprecated `id` of update_template_metadata is still accepted (see [stored-template ops]) but not listed.
    check('update_template_metadata does not list the deprecated id', !('id' in props('update_template_metadata')) && 'moveToTemplateId' in props('update_template_metadata'));

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
    check('→ DOCX', isBinaryDoc(await call('convert_document', { file: INV, convertTo: 'docx' }), 'officedocument', 'docx'));
    check('→ TXT inline text', typeOf(await call('convert_document', { file: INV, convertTo: 'txt' })) === 'text');
    check('→ TXT asAttachment = resource', mimeOf(await call('convert_document', { file: INV, convertTo: 'txt', asAttachment: true })) === 'text/plain');
    check('returnLink → one-time download URL', isOneTimeLink(await call('convert_document', { file: INV, convertTo: 'pdf', converter: 'C', returnLink: true })));
    check('bad converter rejected (validation)', (await call('convert_document', { file: INV, convertTo: 'pdf', converter: 'X' })).isError === true);
    // Image export with Chromium (API 5.17.0+): HTML/SVG → PNG, JPG, WEBP and SVG → PDF, sized by the
    // formatOptions the descriptions document. The image comes back inline, so the assistant can look at it.
    const webp = await call('convert_document', { file: INV, convertTo: { formatName: 'webp', formatOptions: { PixelWidth: 600, Scale: 2, Quality: 80 } }, converter: 'C' });
    check('C: HTML → WEBP inline image', isImage(webp, 'image/webp'), why(webp));
    check('C: Scale 2 doubles PixelWidth (600 → 1200 px)', imageSize(webp)[0] === 1200, `(${imageSize(webp).join('x')})`);
    const crop = await call('convert_document', { file: INV, convertTo: { formatName: 'png', formatOptions: { PixelWidth: 300, PixelHeight: 200, FullPage: false } }, converter: 'C' });
    check('C: FullPage false crops to PixelWidth × PixelHeight (300x200)', isImage(crop, 'image/png') && imageSize(crop).join('x') === '300x200', `(${imageSize(crop).join('x')}) ${why(crop)}`);
    const svgPng = await call('convert_document', { file: SVG, convertTo: 'png', converter: 'C' });
    check('C: SVG → PNG inline image', isImage(svgPng, 'image/png'), why(svgPng));
    const svgPdf = await call('convert_document', { file: SVG, convertTo: 'pdf', converter: 'C' });
    check('C: SVG → PDF', isPdf(svgPdf), why(svgPdf));
    const badOpt = await call('convert_document', { file: INV, convertTo: { formatName: 'png', formatOptions: { PixelWidth: 'big' } }, converter: 'C' });
    check('C: invalid image option refused with an explicit message', badOpt.isError === true && /PixelWidth/.test(text(badOpt)), why(badOpt));
    check('L: HTML → PNG inline image (first page)', isImage(await call('convert_document', { file: INV, convertTo: 'png' }), 'image/png'));
    // failOn on a pure conversion (API 5.16.0+ for Chromium): without it a resource that cannot be downloaded
    // is left out and the conversion succeeds; with it the conversion fails, and the error explains that
    // ENOTFOUND is also what a private-network host gets (Carbone Cloud, and self-hosted from 5.16.0).
    check('C: broken image without failOn → image produced', isImage(await call('convert_document', { file: BROKEN_IMG, convertTo: 'png', converter: 'C' }), 'image/png'));
    const failed = await call('convert_document', { file: BROKEN_IMG, convertTo: 'png', converter: 'C', failOn: ['IMAGE_URL_ERROR'] });
    check('C: broken image + failOn → isError naming the resource', failed.isError === true && /could not be downloaded|Unable to download/i.test(text(failed)), why(failed));
    check('ENOTFOUND error carries the private-network / securityLevel hint', /private network/.test(text(failed)) && /securityLevel/.test(text(failed)));
    check('failOn unknown value rejected (validation)', (await call('convert_document', { file: INV, convertTo: 'png', converter: 'C', failOn: ['NOPE'] })).isError === true);
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
    check('reportName', /bt-conv/.test(IS_STDIO ? text(await call('convert_document', { file: INV, convertTo: 'pdf', converter: 'C', reportName: 'bt-conv' })) : uriOf(await call('convert_document', { file: INV, convertTo: 'pdf', converter: 'C', reportName: 'bt-conv', asAttachment: true }))));
    check('hardRefresh PDF → PDF applies formatOptions', isPdf(await call('convert_document', { file: INV, convertTo: { formatName: 'pdf', formatOptions: { Watermarks: [{ text: 'X', opacity: 0.2 }] } }, converter: 'C', hardRefresh: true })));
    // PDF → PDF only applies formatOptions with hardRefresh (without it Carbone hands the PDF back unchanged).
    // The server sets hardRefresh itself for a PDF input + pdf target with formatOptions, so a caller who just
    // asks to password-protect a PDF must get an encrypted file back without knowing about hardRefresh.
    const pdfIn = blobOf(await call('convert_document', { file: INV, convertTo: 'pdf', converter: 'C', asAttachment: true }));
    if (pdfIn) {
      const pdfEnc = await call('convert_document', { file: pdfIn, convertTo: { formatName: 'pdf', formatOptions: { EncryptFile: true, DocumentOpenPassword: 's3cret' } }, asAttachment: true });
      const pdfEncrypted = Buffer.from(blobOf(pdfEnc), 'base64').includes('/Encrypt');
      check('PDF → PDF + EncryptFile is encrypted (hardRefresh set automatically)', pdfEncrypted, pdfEncrypted ? '' : (why(pdfEnc) || '→ NOT ENCRYPTED'));
    } else {
      note('PDF fixture', 'could not be produced — skipped');
    }
    const cOut = await call('convert_document', { file: INV, convertTo: 'pdf', converter: 'C', outputPath: `/tmp/bt-c-${Date.now()}.pdf` });
    check(IS_STDIO ? 'outputPath writes (stdio)' : 'outputPath rejected (HTTP)', IS_STDIO ? text(cOut).includes('bytes') : (cOut.isError && text(cOut).includes('stdio')));

    // ── converter I (Carbone ICE, API 5.14.0+) ────────────────────────────────────
    // ICE converts DOCX and ODT → PDF, so it cannot reuse the HTML fixtures above. Rather than commit a
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
      // Security-relevant: the tool descriptions say ICE applies the Security PDF options (password,
      // permissions). Asserted so that a deployment that stops honouring them is caught — a PDF the user
      // asked to protect must never come back readable by anyone.
      const iceEnc = await call('convert_document', { file: DOCX, convertTo: { formatName: 'pdf', formatOptions: { EncryptFile: true, DocumentOpenPassword: 's3cret' } }, converter: 'I', asAttachment: true });
      const iceEncrypted = Buffer.from(blobOf(iceEnc), 'base64').includes('/Encrypt');
      check('converter I applies PDF encryption (Security options)', iceEncrypted, iceEncrypted ? '' : `→ NOT ENCRYPTED: docs/descriptions need updating ${why(iceEnc)}`);
      // ICE claims DOCX and ODT only. Carbone may reject another input or quietly fall back to another
      // engine — undocumented either way, so record what this deployment actually did.
      const iceHtml = await call('convert_document', { file: INV, convertTo: 'pdf', converter: 'I' });
      note('converter I on HTML input (DOCX/ODT-only engine)', iceHtml.isError ? `rejected ${why(iceHtml)}` : 'accepted — produced a PDF');
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
    check('→ DOCX', isBinaryDoc(await call('render_document', { template: INV, data: { customer: 'A', total: 1 }, convertTo: 'docx' }), 'officedocument', 'docx'));
    const rImg = await call('render_document', { template: INV, data: { customer: 'Pic', total: 1 }, convertTo: { formatName: 'png', formatOptions: { PixelWidth: 400, Scale: 2 } }, converter: 'C' });
    check('→ PNG inline image, converter C + Scale 2 (800 px)', isImage(rImg, 'image/png') && imageSize(rImg)[0] === 800, `(${imageSize(rImg).join('x')}) ${why(rImg)}`);
    check('failOn IMAGE_URL_ERROR with converter C → isError', (await call('render_document', { template: BROKEN_IMG, data: { customer: 'A' }, convertTo: 'pdf', converter: 'C', failOn: ['IMAGE_URL_ERROR'] })).isError === true);
    check('lang + translations', text(await call('render_document', { template: TRANS, data: { name: 'Al', status: '1' }, convertTo: 'html', lang: 'fr-fr', translations: { 'fr-fr': { hi: 'Bonjour' }, 'en-us': { hi: 'Hello' } }, enum: { ST: { 1: 'Actif' } } })).includes('Bonjour'));
    check('enum convEnum', text(await call('render_document', { template: TRANS, data: { name: 'Al', status: '1' }, convertTo: 'html', enum: { ST: { 1: 'Actif' } } })).includes('Actif'));
    check('currency formatC conversion', /\$|USD/.test(text(await call('render_document', { template: CUR, data: { p: 100 }, convertTo: 'html', currencySource: 'EUR', currencyTarget: 'USD', currencyRates: { EUR: 1, USD: 1.1 } }))));
    check('complement {c.}', text(await call('render_document', { template: COMP, data: { x: 1 }, convertTo: 'html', complement: { company: 'Acme' } })).includes('Acme'));
    check('variableStr (no error)', !(await call('render_document', { template: INV, data: { customer: 'A', total: 1 }, convertTo: 'html', variableStr: '{#z = d.total}' })).isError);
    check('timezone formatD (no error)', !(await call('render_document', { template: DATE, data: { d: '2026-01-15T10:00:00Z' }, convertTo: 'html', timezone: 'Europe/Paris' })).isError);
    check('hardRefresh (no error)', !(await call('render_document', { template: INV, data: { customer: 'A', total: 1 }, convertTo: 'pdf', hardRefresh: true })).isError);
    const rRep = await call('render_document', { template: INV, data: { customer: 'A', total: 1 }, convertTo: 'pdf', converter: 'C', reportName: 'bt-invoice', ...(!IS_STDIO && { asAttachment: true }) });
    check('reportName (no ext) → filename', IS_STDIO ? (savedToFile(rRep) && /bt-invoice/.test(text(rRep))) : uriOf(rRep).includes('bt-invoice'));
    check('asAttachment = resource', typeOf(await call('render_document', { template: INV, data: { customer: 'A', total: 1 }, convertTo: 'html', asAttachment: true })) === 'resource');
    check('returnLink → one-time download URL', isOneTimeLink(await call('render_document', { template: INV, data: { customer: 'A', total: 1 }, convertTo: 'pdf', converter: 'C', returnLink: true })));
    if (!IS_STDIO) {
      // HTTP's default for a PDF: the one-time link, which downloads as an attachment named after reportName.
      const rLink = await call('render_document', { template: INV, data: { customer: 'Link', total: 1 }, convertTo: 'pdf', converter: 'C', reportName: 'bt-link' });
      check('HTTP default for a PDF: one-time link', isOneTimeLink(rLink), why(rLink));
      const got = await download(linkOf(rLink));
      check('the link downloads the PDF as "bt-link.pdf"', got.status === 200 && got.body.subarray(0, 4).toString() === '%PDF' && /attachment/.test(got.disposition) && /bt-link\.pdf/.test(got.disposition), `(HTTP ${got.status} ${got.disposition})`);
      check('the link works once (second download refused)', (await download(linkOf(rLink))).status !== 200);
    }
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

    // ── inspect: the undocumented isDebugActive render option ─────────────────────────
    // {t()} translation tags are not listed by Carbone, so the fixture has none; its {d.items[i].x} loop must be.
    console.log('\n[inspect_template]');
    const insp = await call('inspect_template', { template: INSPECT });
    const inspS = insp.structuredContent ?? {};
    check('inline: lists {d.name} and {d.items[i].x}', ['{d.name}', '{d.items[i].x}'].every((t) => inspS.tags?.includes(t)), why(insp));
    check('inline: sample.data has name and items', !!inspS.sample?.data && 'name' in inspS.sample.data && 'items' in inspS.sample.data, why(insp));
    check('inspect XOR neither rejected', (await call('inspect_template', {})).isError === true);

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
    const inspId = await call('inspect_template', { templateId: id });
    check('inspect by templateId lists {d.customer}', !!inspId.structuredContent?.tags?.includes('{d.customer}'), why(inspId));
    check('download by id', !(await call('download_template', { templateId: id })).isError);
    check('download by versionId', !(await call('download_template', { templateId: versionId })).isError);
    check('download asAttachment = resource', typeOf(await call('download_template', { templateId: id, asAttachment: true })) === 'resource');
    const dOut = await call('download_template', { templateId: id, outputPath: `/tmp/bt-d-${Date.now()}.html` });
    check(IS_STDIO ? 'download outputPath writes (stdio)' : 'download outputPath rejected (HTTP)', IS_STDIO ? text(dOut).includes('bytes') : dOut.isError === true);
    check('update name+category+tags', !(await call('update_template_metadata', { templateId: id, name: 'BattleTest updated', category: 'bt-cat2', tags: ['bt', 'upd'] })).isError);
    check('update deployedAt', !(await call('update_template_metadata', { templateId: id, deployedAt: 42000000000 })).isError);
    // 1.6.0's \`id\` is a deprecated alias of moveToTemplateId: two different destinations are refused before any API call.
    check('update id ≠ moveToTemplateId rejected', (await call('update_template_metadata', { templateId: versionId, id: '1', moveToTemplateId: '2' })).isError === true);
    // The API refuses a Template ID that is not digits only (400 from 5.16.0); the server says so before calling,
    // naming the field, so a Version ID pasted into one of these inputs is not sent at all.
    const digitsOnly = (r) => r.isError === true && /digits only/.test(text(r));
    check('list_templates id must be digits only', digitsOnly(await call('list_templates', { id: versionId })));
    check('upload_template id must be digits only (nothing uploaded)', digitsOnly(await call('upload_template', { template: INV, id: versionId, name: 'bt-should-not-exist' })));
    check('update moveToTemplateId must be digits only', digitsOnly(await call('update_template_metadata', { templateId: versionId, moveToTemplateId: 'abc' })));
    // sample: true → GET /template/{id}_sample.json — the sample dataset stored at upload, readable back as JSON.
    const smp = await call('download_template', { templateId: upS.id, sample: true });
    check('download sample dataset (JSON, inline)', typeOf(smp) === 'text' && text(smp).includes('SAMPLE-X'), why(smp));
    check('sample on a template without one → isError', (await call('download_template', { templateId: upL.templateId, sample: true })).isError === true);

    console.log('\n[resources]');
    // Direct access by id (render/download/delete) is immediate, but the list/search index that the
    // by-id resource read and completion rely on lags briefly for just-created templates — retry.
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

    console.log('\n[chat attachments — ChatGPT]');
    // The server downloads attachedFile.download_url like a URL input. A one-time Carbone download link is a
    // public HTTPS file that exists nowhere else, so it makes a self-contained fixture (consumed by the one download).
    if (IS_STDIO) {
      const noFile = await call('convert_document', { attachedFile: { download_url: 'https://example.com/a.html', file_id: 'bt' }, convertTo: 'txt' });
      check('stdio: attachedFile is not an input (file still required)', noFile.isError === true, why(noFile));
    } else {
      const att = await call('convert_document', { attachedFile: { download_url: linkOf(await call('convert_document', { file: INV, convertTo: 'html', returnLink: true })), file_id: 'bt-1', file_name: 'invoice.html', mime_type: 'text/html' }, convertTo: 'txt' });
      check('convert_document attachedFile → downloaded and converted', typeOf(att) === 'text' && text(att).includes('{d.customer}'), why(att));
      const attInsp = await call('inspect_template', { attachedTemplate: { download_url: linkOf(await call('convert_document', { file: INSPECT, convertTo: 'html', returnLink: true })), file_id: 'bt-2' } });
      check('inspect_template attachedTemplate → tags', !!attInsp.structuredContent?.tags?.includes('{d.name}'), why(attInsp));
      const attUp = await call('upload_template', { attachedTemplate: { download_url: linkOf(await call('convert_document', { file: INV, convertTo: 'html', returnLink: true })), file_id: 'bt-3', file_name: 'BattleTest-attached.html' }, category: 'bt-cat' });
      const attUpS = track(attUp);
      check('upload_template attachedTemplate → named after the file', !!attUpS.id && /BattleTest-attached/.test(text(attUp)), why(attUp));
      check('attachedFile + file together rejected', /not both/.test(text(await call('convert_document', { file: INV, attachedFile: { download_url: 'https://example.com/a.html', file_id: 'x' }, convertTo: 'txt' }))));
      check('attachedFile with an http:// URL rejected (https only)', (await call('convert_document', { attachedFile: { download_url: 'http://example.com/a.html', file_id: 'x' }, convertTo: 'txt' })).isError === true);
    }

    // ── upload URLs (HTTP, MCP_TICKET_SECRET) ─────────────────────────────────────────
    // upload_template issues a URL bound to one file (size + SHA-256); the file is then POSTed to it, as the
    // assistant's sandbox would with the curl command the tool returns.
    console.log('\n[upload URLs]');
    if (!UPLOAD_URLS) {
      note('skipped', IS_STDIO ? 'stdio' : 'not offered by this server (no MCP_TICKET_SECRET)');
    } else {
      const file = Buffer.from(Buffer.from(INV, 'base64').toString().replace('Invoice for', `Invoice ${Date.now()} for`));
      const sha256 = createHash('sha256').update(file).digest('hex');
      const issued = await call('upload_template', { requestUploadUrl: { size: file.length, sha256 }, name: `BattleTest-url ${Date.now()}`, category: 'bt-cat' });
      const u = issued.structuredContent ?? {};
      check('requestUploadUrl → uploadUrl, ticket header, expiresAt, curl command', typeof u.uploadUrl === 'string'
        && Object.keys(u.headers ?? {}).length === 1 && u.expiresAt > Date.now() / 1000 && /curl -sS/.test(text(issued)), why(issued));
      if (u.uploadUrl) {
        const post = (body, headers = u.headers) => fetch(u.uploadUrl, { method: 'POST', headers, body })
          .then(async (res) => ({ status: res.status, json: await res.json().catch(() => ({})) }))
          .catch((e) => ({ status: 0, json: { error: e.message } }));
        check('no ticket header → 401', (await post(file, {})).status === 401);
        check('forged ticket → 401', (await post(file, { [Object.keys(u.headers)[0]]: 'v1.forged' })).status === 401);
        check('GET → 405', (await fetch(u.uploadUrl, { headers: u.headers })).status === 405);
        const other = Buffer.from(file);
        other[other.length - 1] ^= 1; // same size, other bytes
        const wrongHash = await post(other);
        check('other bytes of the same size → 400, nothing stored', wrongHash.status === 400, wrongHash.status === 400 ? '' : `(HTTP ${wrongHash.status} ${wrongHash.json.error ?? ''})`);
        check('another size → refused', [400, 413].includes((await post(Buffer.concat([file, Buffer.from(' ')]))).status));
        const up = await post(file);
        const upId = up.json.id ?? up.json.templateId;
        if (upId) created.push(upId);
        check('the file → 200, the stored template (id + versionId)', up.status === 200 && !!up.json.id && !!up.json.versionId, up.status === 200 ? '' : `(HTTP ${up.status} ${up.json.error ?? ''})`);
        if (up.json.id) {
          check('render the uploaded template by its id', text(await call('render_document', { templateId: up.json.id, data: { customer: 'ByUrl', total: 1 }, convertTo: 'html' })).includes('ByUrl'));
        }
      }
      check('requestUploadUrl + template rejected', /not both/.test(text(await call('upload_template', { template: INV, requestUploadUrl: { size: 10, sha256: '0'.repeat(64) } }))));
      check('requestUploadUrl over the size limit rejected', (await call('upload_template', { requestUploadUrl: { size: 2 ** 40, sha256: '0'.repeat(64) } })).isError === true);
    }

    // ── async renders (HTTP, MCP_TICKET_SECRET + a job store) ───────────────────────
    // The server is Carbone's webhook: render_document with async: true returns a job ID, Carbone calls the
    // server back once the document is ready, and get_render_result returns the one-time link, from any instance.
    console.log('\n[async renders]');
    if (!ASYNC) {
      note('skipped', IS_STDIO ? 'stdio' : 'not offered by this server (no MCP_TICKET_SECRET with MCP_S3_* or MCP_JOBS_DIR)');
    } else {
      const jobOf = (r) => text(r).match(/Job ID:\n(\S+)/)?.[1];
      // Polls like an assistant, every 2 s, for up to 2 minutes.
      const resultOf = async (jobId) => {
        for (let i = 0; i < 60; i++) {
          const r = await call('get_render_result', { jobId });
          if (r.isError || !/^Still rendering/.test(text(r))) return r;
          await sleep(2000);
        }
        return { isError: true, content: [{ type: 'text', text: 'still rendering after 2 minutes: the webhook call never arrived?' }] };
      };
      const started = await call('render_document', { template: INV, data: { customer: 'Async', total: 3 }, convertTo: 'pdf', converter: 'C', reportName: 'bt-async', async: true });
      const jobId = jobOf(started);
      check('async: true → a job ID at once', !!jobId, why(started));
      if (jobId) {
        const done = await resultOf(jobId);
        check('get_render_result → the one-time link (Carbone called the webhook, the store kept it)', isOneTimeLink(done), why(done));
        const got = await download(linkOf(done));
        check('the link downloads the PDF as "bt-async.pdf"', got.status === 200 && got.body.subarray(0, 4).toString() === '%PDF' && /bt-async\.pdf/.test(got.disposition), `(HTTP ${got.status} ${got.disposition})`);
        check('get_render_result again: the same result (readable for an hour)', linkOf(await call('get_render_result', { jobId })) === linkOf(done));
      }
      const batch = await call('render_document', { template: INV, data: { items: [{ customer: 'B1', total: 1 }, { customer: 'B2', total: 2 }] }, convertTo: 'pdf', converter: 'C', batchSplitBy: 'd.items', batchOutput: 'zip', async: true });
      const batchJob = jobOf(batch);
      check('batch with async: true, no webhookUrl of its own → a job ID', !!batchJob, why(batch));
      if (batchJob) {
        const done = await resultOf(batchJob);
        const got = await download(linkOf(done));
        check('batch result: a ZIP', got.status === 200 && got.body.subarray(0, 2).toString() === 'PK', `(HTTP ${got.status}) ${why(done)}`);
      }
      // A render that fails once running: refused at once, or recorded by the webhook as failed.
      const bad = await call('render_document', { template: BROKEN_IMG, data: { customer: 'A' }, convertTo: 'pdf', converter: 'C', failOn: ['IMAGE_URL_ERROR'], async: true });
      const badJob = jobOf(bad);
      const badResult = badJob ? await resultOf(badJob) : bad;
      check('a failing async render ends in an error, with Carbone\'s message', badResult.isError === true && /fail|download|image/i.test(text(badResult)), why(badResult));
      check('async + webhookUrl rejected', /not both/.test(text(await call('render_document', { template: INV, data: {}, async: true, webhookUrl: 'https://example.com/hook' }))));
      check('unknown job ID → isError', /Unknown or expired/.test(text(await call('get_render_result', { jobId: 'v1.forged' }))));
      // The webhook route itself: only Carbone, with the sealed job token, can record a result.
      const hook = new URL('/webhook', MCP_URL);
      const forged = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-job-token': 'v1.forged' }, body: '{"success":true,"data":{"renderId":"x.pdf"}}' }).catch(() => ({ status: 0 }));
      check('/webhook with a forged job token → 401', forged.status === 401);
      check('/webhook GET → 405', (await fetch(hook).catch(() => ({ status: 0 }))).status === 405);
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
