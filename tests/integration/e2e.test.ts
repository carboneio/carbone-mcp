import { describe, test, expect } from 'vitest';
import { CarboneClient } from '../../src/carbone/client.js';
import { readTemplateByIdResource, completeTemplateId } from '../../src/resources/templates.js';

/**
 * Integration tests — require a real Carbone API key.
 * Run with: CARBONE_TEST_API_KEY=your_key npm run test:integration
 *
 * These tests use the Carbone staging environment to avoid affecting production data.
 */

const TEST_API_KEY = process.env['CARBONE_TEST_API_KEY'];
const BASE_URL = process.env['CARBONE_TEST_BASE_URL'] ?? 'https://api.carbone.io';

// Proper HTML template per Carbone HTML guide:
// https://carbone.io/documentation/design/template-formats/html.html
const HTML_TEMPLATE = Buffer.from(`<!DOCTYPE html>
<html>
<head><title>Integration Test</title></head>
<body>
  <h1>Invoice for {d.customer}</h1>
  <table>
    <thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead>
    <tbody>
      <tr>
        <td>{d.items[i].name}</td>
        <td>{d.items[i].qty}</td>
        <td>{d.items[i].price:formatN(2)} EUR</td>
      </tr>
      <tr><td>{d.items[i+1]}</td></tr>
    </tbody>
  </table>
  <p>Total: {d.total:formatN(2)} EUR</p>
</body>
</html>`).toString('base64');

const HTML_DATA = {
  customer: 'Acme Corp',
  items: [
    { name: 'Consulting', qty: 3, price: 500 },
    { name: 'Support',    qty: 1, price: 200 },
  ],
  total: 1700,
};

type BinaryResult = { buffer: Buffer; filename: string };

/** Narrow a render/convert result to its binary (inline bytes) shape, asserting it isn't a link/async result. */
function binary(
  r: BinaryResult | { async: true; message: string } | { renderId: string }
): BinaryResult {
  if (!('buffer' in r)) throw new Error(`expected a binary result, got ${JSON.stringify(r)}`);
  return r;
}

describe.skipIf(!TEST_API_KEY)('Integration — Carbone API', () => {
  const client = new CarboneClient({
    apiKey: TEST_API_KEY!,
    baseUrl: BASE_URL,
  });

  // ── Status ──────────────────────────────────────────────────────────────────

  test('GET /status — returns version string', async () => {
    const status = await client.getStatus();
    expect(typeof status.version).toBe('string');
    expect(status.version.length).toBeGreaterThan(0);
    expect(typeof status.message).toBe('string');
  });

  // ── Convert ─────────────────────────────────────────────────────────────────

  test('POST /render/template — converts HTML to PDF (Chromium)', async () => {
    const result = binary(await client.convertDocument({
      template: HTML_TEMPLATE,
      convertTo: 'pdf',
      converter: 'C',
    }));

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(result.filename).toMatch(/\.pdf$/i);
  });

  test('POST /render/template — converts HTML to TXT', async () => {
    const result = binary(await client.convertDocument({
      template: HTML_TEMPLATE,
      convertTo: 'txt',
    }));

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  test('POST /render/template — converts to PDF with object-form convertTo + formatOptions', async () => {
    const result = binary(await client.convertDocument({
      template: HTML_TEMPLATE,
      convertTo: { formatName: 'pdf', formatOptions: { Watermarks: [{ text: 'DRAFT', opacity: 0.2 }] } },
      converter: 'C',
    }));

    expect(result.buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  // ── List ────────────────────────────────────────────────────────────────────

  test('GET /templates — returns an array of template objects', async () => {
    const { templates } = await client.listTemplates();
    expect(Array.isArray(templates)).toBe(true);
  });

  test('GET /templates — respects limit param', async () => {
    const { templates } = await client.listTemplates({ limit: 2 });
    expect(templates.length).toBeLessThanOrEqual(2);
  });

  test('GET /templates — returns pagination metadata (hasMore boolean)', async () => {
    const res = await client.listTemplates({ limit: 1 });
    expect(Array.isArray(res.templates)).toBe(true);
    expect(typeof res.hasMore).toBe('boolean');
  });

  test('GET /templates/categories — returns an array of strings', async () => {
    const categories = await client.getCategories();
    expect(Array.isArray(categories)).toBe(true);
    categories.forEach((c) => expect(typeof c).toBe('string'));
  });

  test('GET /templates/tags — returns an array of strings', async () => {
    const tags = await client.getTags();
    expect(Array.isArray(tags)).toBe(true);
    tags.forEach((t) => expect(typeof t).toBe('string'));
  });

  // ── Inline render ───────────────────────────────────────────────────────────

  test('POST /render/template — renders HTML template with data injection', async () => {
    const result = binary(await client.renderDocument({
      template: HTML_TEMPLATE,
      data: HTML_DATA,
      convertTo: 'html',
    }));

    const html = result.buffer.toString('utf8');
    expect(html).toContain('Acme Corp');
    expect(html).toContain('Consulting');
    expect(html).toContain('Support');
    expect(html).toContain('1,700.00');
  });

  test('POST /render/template — renders a top-level array dataset ({d[i]})', async () => {
    const template = Buffer.from(
      '<!DOCTYPE html><html><body><ul><li>{d[i].name}</li><li>{d[i+1].name}</li></ul></body></html>'
    ).toString('base64');

    const result = binary(await client.renderDocument({
      template,
      data: [{ name: 'Alice' }, { name: 'Bob' }],
      convertTo: 'html',
    }));

    const html = result.buffer.toString('utf8');
    expect(html).toContain('Alice');
    expect(html).toContain('Bob');
  });

  // ── returnLink (one-time public download URL) ────────────────────────────────

  test('POST /render/template?download=false — returnLink yields a renderId whose URL downloads once', async () => {
    const result = await client.renderDocument({
      template: HTML_TEMPLATE,
      data: HTML_DATA,
      convertTo: 'pdf',
      converter: 'C',
      returnLink: true,
    });

    expect('renderId' in result).toBe(true);
    const { renderId } = result as { renderId: string };
    expect(typeof renderId).toBe('string');
    expect(renderId.length).toBeGreaterThan(0);

    const url = client.renderUrl(renderId);
    expect(url).toBe(`${BASE_URL}/render/${renderId}`);

    // The link is public (no auth) and one-time: the first GET returns the PDF.
    const first = await fetch(url);
    expect(first.status).toBe(200);
    const bytes = Buffer.from(await first.arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');

    // The file is consumed after the first download — a second GET no longer returns the PDF.
    const second = await fetch(url);
    expect(second.ok).toBe(false);
  });

  test('convertDocument with returnLink yields a renderId (no inline buffer)', async () => {
    const result = await client.convertDocument({
      template: HTML_TEMPLATE,
      convertTo: 'pdf',
      converter: 'C',
      returnLink: true,
    });

    expect('renderId' in result).toBe(true);
    expect('buffer' in result).toBe(false);
    const { renderId } = result as { renderId: string };
    expect(client.renderUrl(renderId)).toContain(renderId);
  });

  // ── Lang + Translations ──────────────────────────────────────────────────────

  test('POST /render/template — renders with lang and translations', async () => {
    const template = Buffer.from(`<!DOCTYPE html>
<html><body>
  <p>{t(greeting)}, {d.name}!</p>
  <p>{t(farewell)}</p>
</body></html>`).toString('base64');

    const result = binary(await client.renderDocument({
      template,
      data: { name: 'Alice' },
      convertTo: 'html',
      lang: 'fr-fr',
      translations: {
        'fr-fr': { greeting: 'Bonjour', farewell: 'Au revoir' },
        'en-us': { greeting: 'Hello',   farewell: 'Goodbye'   },
      },
    }));

    const html = result.buffer.toString('utf8');
    expect(html).toContain('Bonjour');
    expect(html).toContain('Au revoir');
    expect(html).toContain('Alice');
  });

  // ── listTemplates filtering ──────────────────────────────────────────────────

  test('GET /templates — filters by category', async () => {
    const uploaded = await client.uploadTemplate({
      template: HTML_TEMPLATE,
      name: 'Category Filter Test',
      category: 'e2e-filter-test',
      versioning: true,
    });
    const { id: templateId } = uploaded as { id: string };

    try {
      const { templates: results } = await client.listTemplates({ category: 'e2e-filter-test' });
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      results.forEach((t) => expect(t.category).toBe('e2e-filter-test'));
    } finally {
      await client.deleteTemplate(templateId);
    }
  });

  test('GET /templates — filters by search', async () => {
    const uniqueName = `E2E-Search-Test-${Date.now()}`;
    const uploaded = await client.uploadTemplate({
      template: HTML_TEMPLATE,
      name: uniqueName,
      versioning: true,
    });
    const { id: templateId } = uploaded as { id: string };

    try {
      const { templates: results } = await client.listTemplates({ search: uniqueName });
      expect(Array.isArray(results)).toBe(true);
      expect(results.some((t) => t.name === uniqueName)).toBe(true);
    } finally {
      await client.deleteTemplate(templateId);
    }
  });

  // ── Resource: carbone://templates/{id} + completion ─────────────────────────

  test('resource: readTemplateByIdResource fetches a template by ID; completion returns an array', async () => {
    const uploaded = await client.uploadTemplate({
      template: HTML_TEMPLATE,
      name: `E2E-ById-${Date.now()}`,
      versioning: true,
    });
    const { id: templateId } = uploaded as { id: string };

    try {
      const res = await readTemplateByIdResource(
        new URL(`carbone://templates/${templateId}`),
        templateId,
        client
      );
      const templates = JSON.parse((res.contents[0] as { text: string }).text) as { id?: string }[];
      expect(templates.some((t) => t.id === templateId)).toBe(true);

      const completions = await completeTemplateId(templateId, client);
      expect(Array.isArray(completions)).toBe(true);
    } finally {
      await client.deleteTemplate(templateId);
    }
  });

  // ── Full lifecycle: upload → render → download → update → delete ────────────

  test('full template lifecycle', async () => {
    // Upload
    const uploaded = await client.uploadTemplate({
      template: HTML_TEMPLATE,
      name: 'Integration Test Template',
      category: 'tests',
      tags: ['integration', 'mcp'],
      versioning: true,
    });

    expect('id' in uploaded).toBe(true);
    expect('versionId' in uploaded).toBe(true);
    const { id: templateId, versionId } = uploaded as { id: string; versionId: string };
    expect(typeof templateId).toBe('string');
    expect(typeof versionId).toBe('string');

    // Render with stored templateId
    const rendered = binary(await client.renderDocument({
      templateId,
      data: HTML_DATA,
      convertTo: 'html',
    }));
    const html = rendered.buffer.toString('utf8');
    expect(html).toContain('Acme Corp');
    expect(html).toContain('1,700.00');

    // Download — verify we get the original template bytes back
    const downloaded = await client.downloadTemplate(templateId);
    expect(downloaded.buffer).toBeInstanceOf(Buffer);
    expect(downloaded.buffer.length).toBeGreaterThan(0);
    const content = downloaded.buffer.toString('utf8');
    expect(content).toContain('{d.customer}');
    expect(content).toContain('{d.items[i].name}');

    // Update metadata
    await expect(
      client.updateTemplate({
        templateId,
        name: 'Integration Test Template (updated)',
        tags: ['integration', 'mcp', 'updated'],
      })
    ).resolves.not.toThrow();

    // Delete
    await expect(client.deleteTemplate(templateId)).resolves.not.toThrow();
  });
});
