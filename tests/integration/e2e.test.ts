import { describe, test, expect } from 'vitest';
import { CarboneClient } from '../../src/carbone/client.js';

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
    const result = await client.convertDocument({
      template: HTML_TEMPLATE,
      convertTo: 'pdf',
      converter: 'C',
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(result.filename).toMatch(/\.pdf$/i);
  });

  test('POST /render/template — converts HTML to TXT', async () => {
    const result = await client.convertDocument({
      template: HTML_TEMPLATE,
      convertTo: 'txt',
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  // ── List ────────────────────────────────────────────────────────────────────

  test('GET /templates — returns an array of template objects', async () => {
    const templates = await client.listTemplates();
    expect(Array.isArray(templates)).toBe(true);
  });

  test('GET /templates — respects limit param', async () => {
    const templates = await client.listTemplates({ limit: 2 });
    expect(templates.length).toBeLessThanOrEqual(2);
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
    const result = await client.renderDocument({
      template: HTML_TEMPLATE,
      data: HTML_DATA,
      convertTo: 'html',
    });

    const html = result.buffer.toString('utf8');
    expect(html).toContain('Acme Corp');
    expect(html).toContain('Consulting');
    expect(html).toContain('Support');
    expect(html).toContain('1,700.00');
  });

  // ── Lang + Translations ──────────────────────────────────────────────────────

  test('POST /render/template — renders with lang and translations', async () => {
    const template = Buffer.from(`<!DOCTYPE html>
<html><body>
  <p>{t(greeting)}, {d.name}!</p>
  <p>{t(farewell)}</p>
</body></html>`).toString('base64');

    const result = await client.renderDocument({
      template,
      data: { name: 'Alice' },
      convertTo: 'html',
      lang: 'fr-fr',
      translations: {
        'fr-fr': { greeting: 'Bonjour', farewell: 'Au revoir' },
        'en-us': { greeting: 'Hello',   farewell: 'Goodbye'   },
      },
    });

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
      const results = await client.listTemplates({ category: 'e2e-filter-test' });
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
      const results = await client.listTemplates({ search: uniqueName });
      expect(Array.isArray(results)).toBe(true);
      expect(results.some((t) => t.name === uniqueName)).toBe(true);
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
    const rendered = await client.renderDocument({
      templateId,
      data: HTML_DATA,
      convertTo: 'html',
    });
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
