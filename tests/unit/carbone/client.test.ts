import { describe, test, expect, vi, beforeEach } from 'vitest';
import { CarboneClient } from '../../../src/carbone/client.js';
import {
  CarboneAuthError,
  CarboneConnectionError,
  CarboneError,
  CarboneGenerationError,
  CarboneNotFoundError,
  CarboneRateLimitError,
  CarboneValidationError,
} from '../../../src/carbone/errors.js';
import { formatError } from '../../../src/utils/errors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(overrides: Partial<Response> & { _json?: unknown; _arrayBuffer?: ArrayBuffer }) {
  const { _json, _arrayBuffer, ...rest } = overrides;
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => _json ?? {},
    arrayBuffer: async () => _arrayBuffer ?? new ArrayBuffer(0),
    ...rest,
  } as unknown as Response);
}

function mockFetchError(status: number, body: unknown, headers?: HeadersInit) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: false,
    status,
    statusText: 'Error',
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CarboneClient', () => {
  let client: CarboneClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new CarboneClient({ apiKey: 'test-key' });
  });

  // ── Constructor ─────────────────────────────────────────────────────────────

  describe('constructor', () => {
    test('uses default base URL and timeout', () => {
      expect(client['baseUrl']).toBe('https://api.carbone.io');
      expect(client['timeout']).toBe(60000);
    });

    test('accepts custom base URL and timeout', () => {
      const c = new CarboneClient({ apiKey: 'k', baseUrl: 'https://custom.io', timeout: 5000 });
      expect(c['baseUrl']).toBe('https://custom.io');
      expect(c['timeout']).toBe(5000);
    });

    test('apiKey is optional — omitting it does not throw at construction', () => {
      expect(() => new CarboneClient({})).not.toThrow();
    });
  });

  // ── Stateless auth (per-call options) ────────────────────────────────────────

  describe('per-call apiKey (stateless auth)', () => {
    test('per-call apiKey overrides constructor apiKey in Authorization header', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await client.convertDocument({ template: 'abc', convertTo: 'pdf' }, { apiKey: 'per-call-key' });

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer per-call-key' }),
        })
      );
    });

    test('constructor apiKey is used when no per-call options provided', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await client.convertDocument({ template: 'abc', convertTo: 'pdf' });

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        })
      );
    });

    test('constructor apiKey is used when options object has no apiKey', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await client.convertDocument({ template: 'abc', convertTo: 'pdf' }, {});

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        })
      );
    });

    test('throws CarboneAuthError when targeting cloud API with no apiKey', async () => {
      const statelessClient = new CarboneClient({});  // defaults to cloud URL

      await expect(
        statelessClient.convertDocument({ template: 'abc', convertTo: 'pdf' })
      ).rejects.toBeInstanceOf(CarboneAuthError);
    });

    test('error message defaults to stdio when transport is not specified', async () => {
      const statelessClient = new CarboneClient({});

      await expect(
        statelessClient.convertDocument({ template: 'abc', convertTo: 'pdf' })
      ).rejects.toThrow('Set the CARBONE_API_KEY environment variable');
    });

    test('error message in stdio transport mentions CARBONE_API_KEY env var', async () => {
      const statelessClient = new CarboneClient({ transport: 'stdio' });

      await expect(
        statelessClient.convertDocument({ template: 'abc', convertTo: 'pdf' })
      ).rejects.toThrow('Set the CARBONE_API_KEY environment variable');
    });

    test('error message in http transport mentions Bearer token', async () => {
      const statelessClient = new CarboneClient({ transport: 'http' });

      await expect(
        statelessClient.convertDocument({ template: 'abc', convertTo: 'pdf' })
      ).rejects.toThrow('Authorization: Bearer');
    });

    test('stateless client succeeds when apiKey is provided per-call', async () => {
      const statelessClient = new CarboneClient({ baseUrl: CarboneClient.CLOUD_API_URL });

      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await statelessClient.convertDocument(
        { template: 'abc', convertTo: 'pdf' },
        { apiKey: 'runtime-key' }
      );

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer runtime-key' }),
        })
      );
    });

    test('requireClientAuth (HTTP): rejects a request with no per-call key even when a server key is set', async () => {
      const serverKeyClient = new CarboneClient({
        apiKey: 'operator-key',
        transport: 'http',
        requireClientAuth: true,
      });

      await expect(
        serverKeyClient.convertDocument({ template: 'abc', convertTo: 'pdf' })
      ).rejects.toBeInstanceOf(CarboneAuthError);
    });

    test('requireClientAuth (HTTP): allows a request that provides a per-call key', async () => {
      const serverKeyClient = new CarboneClient({
        apiKey: 'operator-key',
        transport: 'http',
        requireClientAuth: true,
      });

      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await serverKeyClient.convertDocument({ template: 'abc', convertTo: 'pdf' }, { apiKey: 'client-key' });

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer client-key' }),
        })
      );
    });

    test('requireClientAuth has no effect in stdio mode (server key is used)', async () => {
      const stdioClient = new CarboneClient({
        apiKey: 'env-key',
        transport: 'stdio',
        requireClientAuth: true,
      });

      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await stdioClient.convertDocument({ template: 'abc', convertTo: 'pdf' });

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer env-key' }),
        })
      );
    });

    // ── Security: the operator's key must never leak to anonymous HTTP callers ──
    test('templateId is URL-encoded so it cannot reshape the API request path', async () => {
      const c = new CarboneClient({ apiKey: 'k' });
      const spy = mockFetch({ headers: new Headers(), _arrayBuffer: new ArrayBuffer(1) });

      // A traversal/query payload must land encoded inside the path segment, not alter it.
      await c.deleteTemplate('../../admin?x=1');

      const url = spy.mock.calls[0][0] as string;
      expect(url).toBe('https://api.carbone.io/template/..%2F..%2Fadmin%3Fx%3D1');
      expect(url).not.toContain('/admin?');
    });

    test('HTTP: an anonymous request falls back to the server key (documented shared-key default)', async () => {
      const shared = new CarboneClient({ apiKey: 'operator-key', transport: 'http', requireClientAuth: false });
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await shared.convertDocument({ template: 'abc', convertTo: 'pdf' });

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer operator-key' }),
        })
      );
    });

    test('HTTP + on-premise: still works unauthenticated (fail-closed must not break on-prem)', async () => {
      const onPremHttp = new CarboneClient({ baseUrl: 'https://carbone.my-company.com', transport: 'http' });
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await expect(onPremHttp.convertDocument({ template: 'abc', convertTo: 'pdf' })).resolves.toBeDefined();
      const sentHeaders = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(sentHeaders).not.toHaveProperty('Authorization');
    });

    test('on-premise: no apiKey and custom baseUrl — does NOT throw', async () => {
      const onPremClient = new CarboneClient({ baseUrl: 'https://carbone.my-company.com' });

      mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await expect(
        onPremClient.convertDocument({ template: 'abc', convertTo: 'pdf' })
      ).resolves.toBeDefined();
    });

    test('on-premise: no Authorization header is sent when no apiKey', async () => {
      const onPremClient = new CarboneClient({ baseUrl: 'https://carbone.my-company.com' });

      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await onPremClient.convertDocument({ template: 'abc', convertTo: 'pdf' });

      const sentHeaders = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(sentHeaders['Authorization']).toBeUndefined();
    });

    test('on-premise: empty string apiKey is treated as no auth', async () => {
      const onPremClient = new CarboneClient({ apiKey: '', baseUrl: 'https://carbone.my-company.com' });

      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await onPremClient.convertDocument({ template: 'abc', convertTo: 'pdf' });

      const sentHeaders = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(sentHeaders['Authorization']).toBeUndefined();
    });

    test('on-premise stdio: custom URL + CARBONE_API_KEY → Authorization header IS sent', async () => {
      // On-premise Carbone with authentication enabled (custom key set via env var / constructor)
      const onPremClient = new CarboneClient({
        apiKey: 'on-prem-secret',
        baseUrl: 'https://carbone.my-company.com',
      });

      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await onPremClient.convertDocument({ template: 'abc', convertTo: 'pdf' });

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer on-prem-secret' }),
        })
      );
    });

    test('on-premise HTTP passthrough: custom URL + per-call apiKey → Authorization header IS sent', async () => {
      // On-premise server running in HTTP mode — no constructor key, key forwarded per-request
      const onPremClient = new CarboneClient({ baseUrl: 'https://carbone.my-company.com' });

      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await onPremClient.convertDocument(
        { template: 'abc', convertTo: 'pdf' },
        { apiKey: 'on-prem-per-call-key' }
      );

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer on-prem-per-call-key' }),
        })
      );
    });

    test('per-call apiKey is forwarded through renderDocument', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="doc.pdf"' }),
        _arrayBuffer: new ArrayBuffer(20),
      });

      await client.renderDocument({ templateId: 'tpl1', data: {} }, { apiKey: 'render-key' });

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer render-key' }),
        })
      );
    });

    test('per-call apiKey is forwarded through listTemplates', async () => {
      const spy = mockFetch({ _json: { data: [] } });

      await client.listTemplates(undefined, { apiKey: 'list-key' });

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer list-key' }),
        })
      );
    });
  });

  // ── convertDocument ─────────────────────────────────────────────────────────

  describe('convertDocument', () => {
    test('posts to /render/template?download=true with correct headers', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await client.convertDocument({ template: 'abc', convertTo: 'pdf' });

      expect(spy).toHaveBeenCalledWith(
        'https://api.carbone.io/render/template?download=true',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
            'carbone-version': '5',
          }),
        })
      );
    });

    test('includes converter in body when provided', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await client.convertDocument({ template: 'abc', convertTo: 'pdf', converter: 'C' });

      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.converter).toBe('C');
    });

    test('sends a pure conversion body: no data key, so Carbone keeps the tags', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await client.convertDocument({ template: 'abc', convertTo: 'pdf' });

      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({ template: 'abc', convertTo: 'pdf' });
    });

    test('passes converter "I" and hardRefresh through when set', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="out.pdf"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });
      const convertTo = { formatName: 'pdf', formatOptions: { SelectPdfVersion: 4 } };

      await client.convertDocument({ template: 'abc', convertTo, converter: 'I', hardRefresh: true });

      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({ template: 'abc', convertTo, converter: 'I', hardRefresh: true });
    });

    test('returns buffer and filename from content-disposition', async () => {
      mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="invoice.pdf"' }),
        _arrayBuffer: new ArrayBuffer(50),
      });

      const result = await client.convertDocument({ template: 'abc', convertTo: 'pdf' }) as { buffer: Buffer; filename: string };
      expect(result.filename).toBe('invoice.pdf');
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBe(50);
    });

    test('falls back to "document" when content-disposition is missing', async () => {
      mockFetch({ headers: new Headers(), _arrayBuffer: new ArrayBuffer(10) });

      const result = await client.convertDocument({ template: 'abc', convertTo: 'pdf' }) as { buffer: Buffer; filename: string };
      expect(result.filename).toBe('document');
    });
  });

  // ── renderDocument ──────────────────────────────────────────────────────────

  describe('renderDocument', () => {
    test('posts to /render/{templateId}?download=true', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="doc.pdf"' }),
        _arrayBuffer: new ArrayBuffer(20),
      });

      await client.renderDocument({ templateId: 'tpl123', data: { name: 'Acme' } });

      expect(spy).toHaveBeenCalledWith(
        'https://api.carbone.io/render/tpl123?download=true',
        expect.objectContaining({ method: 'POST' })
      );
    });

    test('sends data:{} by default so tags resolve to empty', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="doc.pdf"' }),
        _arrayBuffer: new ArrayBuffer(20),
      });

      await client.renderDocument({ templateId: 'tpl1' });

      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.data).toEqual({});
    });

    test('keepTags omits data entirely so templating is skipped', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="doc.pdf"' }),
        _arrayBuffer: new ArrayBuffer(20),
      });

      await client.renderDocument({ templateId: 'tpl1', convertTo: 'pdf', keepTags: true });

      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect('data' in body).toBe(false);
      expect(body.convertTo).toBe('pdf');
    });

    test('includes convertTo when convertTo is provided', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="doc.pdf"' }),
        _arrayBuffer: new ArrayBuffer(20),
      });

      await client.renderDocument({ templateId: 'tpl1', data: {}, convertTo: 'docx' });

      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.convertTo).toBe('docx');
    });

    test('posts to /render/template?download=true when inline template is provided', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="doc.pdf"' }),
        _arrayBuffer: new ArrayBuffer(20),
      });

      await client.renderDocument({ template: 'base64abc==', data: { name: 'Acme' } });

      expect(spy).toHaveBeenCalledWith(
        'https://api.carbone.io/render/template?download=true',
        expect.objectContaining({ method: 'POST' })
      );
      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.template).toBe('base64abc==');
      expect(body.data).toEqual({ name: 'Acme' });
    });

    test('includes all optional fields in request body', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="doc.pdf"' }),
        _arrayBuffer: new ArrayBuffer(20),
      });

      await client.renderDocument({
        templateId: 'tpl1',
        data: { price: 100 },
        convertTo: 'pdf',
        converter: 'O',
        lang: 'fr-fr',
        timezone: 'Europe/Paris',
        complement: { company: 'Acme' },
        variableStr: '{#total = d.price * 2}',
        reportName: 'report-{d.id}',
        enum: { STATUS: { '1': 'Active' } },
        translations: { 'fr-fr': { hello: 'Bonjour' } },
        currencySource: 'EUR',
        currencyTarget: 'USD',
        currencyRates: { EUR: 1, USD: 1.08 },
        hardRefresh: true,
        batchSplitBy: 'd.invoices',
        batchOutput: 'zip',
        batchReportName: 'invoice-{d.id}',
      });

      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.convertTo).toBe('pdf');
      expect(body.converter).toBe('O');
      expect(body.lang).toBe('fr-fr');
      expect(body.timezone).toBe('Europe/Paris');
      expect(body.complement).toEqual({ company: 'Acme' });
      expect(body.variableStr).toBe('{#total = d.price * 2}');
      expect(body.reportName).toBe('report-{d.id}');
      expect(body.currencySource).toBe('EUR');
      expect(body.currencyTarget).toBe('USD');
      expect(body.currencyRates).toEqual({ EUR: 1, USD: 1.08 });
      expect(body.hardRefresh).toBe(true);
      expect(body.batchSplitBy).toBe('d.invoices');
      expect(body.batchOutput).toBe('zip');
      expect(body.batchReportName).toBe('invoice-{d.id}');
    });

    test('defaults data to {} (templating runs) and omits failOn / preReleaseFeatureIn when not set', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="doc.pdf"' }),
        _arrayBuffer: new ArrayBuffer(20),
      });

      await client.renderDocument({ template: 'base64abc==', convertTo: 'pdf' });

      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({ data: {}, template: 'base64abc==', convertTo: 'pdf' });
    });

    test('passes failOn, preReleaseFeatureIn and converter "I" through when set', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="doc.pdf"' }),
        _arrayBuffer: new ArrayBuffer(20),
      });

      await client.renderDocument({
        templateId: 'tpl1',
        data: { id: 1 },
        convertTo: 'pdf',
        converter: 'I',
        failOn: ['IMAGE_URL_ERROR'],
        preReleaseFeatureIn: 5000000,
      });

      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({
        data: { id: 1 },
        convertTo: 'pdf',
        converter: 'I',
        failOn: ['IMAGE_URL_ERROR'],
        preReleaseFeatureIn: 5000000,
      });
    });

    test('uses /render/{templateId} without ?download=true when webhookUrl is provided', async () => {
      const spy = mockFetch({ _json: { success: true, message: 'Render queued' } });

      await client.renderDocument({
        templateId: 'tpl123',
        data: {},
        webhookUrl: 'https://example.com/webhook',
      });

      expect(spy).toHaveBeenCalledWith(
        'https://api.carbone.io/render/tpl123',
        expect.objectContaining({ method: 'POST' })
      );
    });

    test('uses /render/template without ?download=true for inline template with webhookUrl', async () => {
      const spy = mockFetch({ _json: { success: true, message: 'Render queued' } });

      await client.renderDocument({
        template: 'base64abc==',
        data: {},
        webhookUrl: 'https://example.com/webhook',
      });

      expect(spy).toHaveBeenCalledWith(
        'https://api.carbone.io/render/template',
        expect.objectContaining({ method: 'POST' })
      );
    });

    test('sends carbone-webhook-url header when webhookUrl is provided', async () => {
      const spy = mockFetch({ _json: { success: true, message: 'Render queued' } });

      await client.renderDocument({
        templateId: 'tpl1',
        data: {},
        webhookUrl: 'https://example.com/webhook',
      });

      const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers['carbone-webhook-url']).toBe('https://example.com/webhook');
    });

    test('sends carbone-webhook-header-* headers when webhookHeaders are provided', async () => {
      const spy = mockFetch({ _json: { success: true, message: 'Render queued' } });

      await client.renderDocument({
        templateId: 'tpl1',
        data: {},
        webhookUrl: 'https://example.com/webhook',
        webhookHeaders: { authorization: 'my-secret', 'custom-id': '12345' },
      });

      const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers['carbone-webhook-header-authorization']).toBe('my-secret');
      expect(headers['carbone-webhook-header-custom-id']).toBe('12345');
    });

    test('does not send carbone-webhook-url header for synchronous render', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="doc.pdf"' }),
        _arrayBuffer: new ArrayBuffer(20),
      });

      await client.renderDocument({ templateId: 'tpl1', data: {} });

      const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers['carbone-webhook-url']).toBeUndefined();
    });

    test('returns { async: true, message } when webhookUrl is provided', async () => {
      mockFetch({ _json: { success: true, message: 'A render ID will be sent to your callback URL' } });

      const result = await client.renderDocument({
        templateId: 'tpl1',
        data: {},
        webhookUrl: 'https://example.com/webhook',
      });

      expect(result).toEqual({ async: true, message: 'A render ID will be sent to your callback URL' });
    });
  });

  // ── uploadTemplate ──────────────────────────────────────────────────────────

  describe('uploadTemplate', () => {
    test('posts to /template and returns result', async () => {
      mockFetch({ _json: { data: { id: 'tpl1', versionId: 'v1' } } });

      const result = await client.uploadTemplate({ template: 'data', name: 'Invoice' });

      expect(result).toEqual({ id: 'tpl1', versionId: 'v1' });
    });

    test('defaults versioning to true', async () => {
      const spy = mockFetch({ _json: { data: { id: 'tpl1', versionId: 'v1' } } });

      await client.uploadTemplate({ template: 'data', name: 'T' });

      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.versioning).toBe(true);
    });

    test('omits name when not given, and sends a single partial sample as is', async () => {
      const spy = mockFetch({ _json: { data: { id: 'tpl1', versionId: 'v1', deployedAt: 0 } } });

      const result = await client.uploadTemplate({ template: 'data', sample: [{ data: { name: 'Acme' } }] });

      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({ template: 'data', versioning: true, sample: [{ data: { name: 'Acme' } }] });
      expect(result).toEqual({ id: 'tpl1', versionId: 'v1', deployedAt: 0 });
    });

    test('returns templateExtension in legacy mode', async () => {
      mockFetch({ _json: { data: { templateId: 'sha', templateExtension: 'docx' } } });

      const result = await client.uploadTemplate({ template: 'data', versioning: false });
      expect(result).toEqual({ templateId: 'sha', templateExtension: 'docx' });
    });

    test('includes category and tags when provided', async () => {
      const spy = mockFetch({ _json: { data: { id: 'tpl1', versionId: 'v1' } } });

      await client.uploadTemplate({
        template: 'data',
        name: 'T',
        category: 'legal',
        tags: ['nda', 'v2'],
      });

      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.category).toBe('legal');
      expect(body.tags).toEqual(['nda', 'v2']);
    });
  });

  // ── updateTemplate ──────────────────────────────────────────────────────────

  describe('updateTemplate', () => {
    test('sends PATCH to /template/{id} with camelCase fields', async () => {
      const spy = mockFetch({ _json: { success: true } });

      await client.updateTemplate({
        templateId: 'tpl1',
        name: 'New Name',
        deployedAt: 42000000000,
        expireAt: 1800000000,
      });

      expect(spy).toHaveBeenCalledWith(
        'https://api.carbone.io/template/tpl1',
        expect.objectContaining({ method: 'PATCH' })
      );
      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.name).toBe('New Name');
      expect(body.deployedAt).toBe(42000000000);
      expect(body.expireAt).toBe(1800000000);
      // Must NOT contain snake_case variants
      expect(body.deployed_at).toBeUndefined();
      expect(body.expire_at).toBeUndefined();
    });

    test('omits undefined fields from body', async () => {
      const spy = mockFetch({ _json: { success: true } });

      await client.updateTemplate({ templateId: 'tpl1', name: 'X' });

      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect(Object.keys(body)).toEqual(['name']);
    });

    test('sends id (move) and expireAt: 0 (cancel deletion), and returns the response data', async () => {
      const data = { versionId: 'sha-v1', id: '1234567890', expireAt: 0 };
      const spy = mockFetch({ _json: { success: true, data } });

      const result = await client.updateTemplate({ templateId: 'sha-v1', id: '1234567890', expireAt: 0 });

      expect(spy).toHaveBeenCalledWith(
        'https://api.carbone.io/template/sha-v1',
        expect.objectContaining({ method: 'PATCH' })
      );
      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({ id: '1234567890', expireAt: 0 });
      expect(result).toEqual(data);
    });
  });

  // ── deleteTemplate ──────────────────────────────────────────────────────────

  describe('deleteTemplate', () => {
    test('sends DELETE to /template/{id}', async () => {
      const spy = mockFetch({ _json: { success: true } });

      await client.deleteTemplate('tpl123');

      expect(spy).toHaveBeenCalledWith(
        'https://api.carbone.io/template/tpl123',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  // ── downloadTemplate ────────────────────────────────────────────────────────

  describe('downloadTemplate', () => {
    test('sends GET to /template/{id} and returns buffer + filename', async () => {
      mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="template.docx"' }),
        _arrayBuffer: new ArrayBuffer(100),
      });

      const result = await client.downloadTemplate('tpl1');

      expect(result.filename).toBe('template.docx');
      expect(result.buffer.length).toBe(100);
    });

    test('sample:true requests /template/{id}_sample.json, the suffix outside the encoded id', async () => {
      const spy = mockFetch({
        headers: new Headers({ 'content-disposition': 'filename="tpl 1_sample.json"' }),
        _arrayBuffer: new ArrayBuffer(10),
      });

      await client.downloadTemplate('tpl 1', { sample: true });

      expect(spy).toHaveBeenCalledWith('https://api.carbone.io/template/tpl%201_sample.json', expect.any(Object));
    });
  });

  // ── listTemplates ───────────────────────────────────────────────────────────

  describe('listTemplates', () => {
    test('sends GET to /templates without params', async () => {
      const spy = mockFetch({ _json: { data: [{ id: '1', name: 'T1' }], hasMore: false } });

      const result = await client.listTemplates();

      expect(spy).toHaveBeenCalledWith('https://api.carbone.io/templates', expect.any(Object));
      expect(result.templates).toHaveLength(1);
      expect(result.hasMore).toBe(false);
    });

    test('exposes hasMore and nextCursor from API response', async () => {
      mockFetch({ _json: { data: [{ id: '1', name: 'T1' }], hasMore: true, nextCursor: 'cursor123' } });

      const result = await client.listTemplates();

      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('cursor123');
    });

    test('includes query params when provided', async () => {
      const spy = mockFetch({ _json: { data: [], hasMore: false } });

      await client.listTemplates({ category: 'invoices', search: 'acme', limit: 10 });

      const url = spy.mock.calls[0][0] as string;
      expect(url).toContain('category=invoices');
      expect(url).toContain('search=acme');
      expect(url).toContain('limit=10');
    });
  });

  // ── getCategories ────────────────────────────────────────────────────────────

  describe('getCategories', () => {
    test('maps { name } objects to strings', async () => {
      mockFetch({ _json: { data: [{ name: 'invoices' }, { name: 'legal' }] } });

      const result = await client.getCategories();
      expect(result).toEqual(['invoices', 'legal']);
    });
  });

  // ── getTags ──────────────────────────────────────────────────────────────────

  describe('getTags', () => {
    test('maps { name } objects to strings', async () => {
      mockFetch({ _json: { data: [{ name: 'sales' }, { name: 'billing' }] } });

      const result = await client.getTags();
      expect(result).toEqual(['sales', 'billing']);
    });
  });

  // ── getStatus ────────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    test('returns version and message from flat response (no data wrapper)', async () => {
      mockFetch({ _json: { success: true, code: 200, message: 'OK', version: '5.3.0' } });

      const result = await client.getStatus();
      expect(result.version).toBe('5.3.0');
      expect(result.message).toBe('OK');
    });
  });

  // ── error handling ───────────────────────────────────────────────────────────

  describe('error handling', () => {
    test('throws CarboneAuthError on 401', async () => {
      mockFetchError(401, { error: 'Unauthorized' });
      await expect(
        client.convertDocument({ template: 'x', convertTo: 'pdf' })
      ).rejects.toBeInstanceOf(CarboneAuthError);
    });

    test('throws CarboneNotFoundError on 404 with API message', async () => {
      mockFetchError(404, { error: 'Template not found' });
      const err = await client.downloadTemplate('missing').catch((e) => e);
      expect(err).toBeInstanceOf(CarboneNotFoundError);
      expect(err.message).toBe('Template not found');
    });

    test('throws CarboneValidationError on 400 with convertTo message', async () => {
      mockFetchError(400, { error: 'Invalid convertTo format' });
      await expect(
        client.convertDocument({ template: 'x', convertTo: 'pdf' })
      ).rejects.toBeInstanceOf(CarboneValidationError);
    });

    test('throws CarboneValidationError on 400 — passes through API message', async () => {
      mockFetchError(400, { error: 'Invalid template file' });
      const err = await client.uploadTemplate({ template: 'x', name: 'T' }).catch((e) => e);
      expect(err).toBeInstanceOf(CarboneValidationError);
      expect(err.message).toBe('Invalid template file');
    });

    test('throws CarboneValidationError on 400 with generic message', async () => {
      mockFetchError(400, { error: 'Bad request' });
      await expect(
        client.renderDocument({ templateId: 'x', data: {} })
      ).rejects.toBeInstanceOf(CarboneValidationError);
    });

    test('throws CarboneError with 413, keeping the API message and code', async () => {
      mockFetchError(413, { success: false, error: 'Template too large, the file size limit is X Bytes', code: 'w119' });
      const err = await client.convertDocument({ template: 'x', convertTo: 'pdf' }).catch((e) => e);
      expect(err).toBeInstanceOf(CarboneError);
      expect(err).toMatchObject({ statusCode: 413, code: 'w119', message: 'Template too large, the file size limit is X Bytes' });
    });

    test('throws CarboneError on 422, keeping the API message and code', async () => {
      mockFetchError(422, { success: false, error: '"template" field is empty', code: 'w112' });
      const err = await client.renderDocument({ templateId: 'x', data: {} }).catch((e) => e);
      expect(err).toMatchObject({ statusCode: 422, code: 'w112', message: '"template" field is empty' });
    });

    test('throws CarboneRateLimitError on 429', async () => {
      mockFetchError(429, {});
      await expect(
        client.convertDocument({ template: 'x', convertTo: 'pdf' })
      ).rejects.toBeInstanceOf(CarboneRateLimitError);
    });

    test('429 without Retry-After header → retryAfterSeconds is undefined', async () => {
      mockFetchError(429, {});
      const err = await client.convertDocument({ template: 'x', convertTo: 'pdf' }).catch((e) => e);
      expect(err).toBeInstanceOf(CarboneRateLimitError);
      expect(err.retryAfterSeconds).toBeUndefined();
    });

    test('429 with numeric Retry-After header → parses seconds', async () => {
      mockFetchError(429, {}, { 'retry-after': '30' });
      const err = await client.convertDocument({ template: 'x', convertTo: 'pdf' }).catch((e) => e);
      expect(err).toBeInstanceOf(CarboneRateLimitError);
      expect(err.retryAfterSeconds).toBe(30);
      expect(err.message).toContain('30');
    });

    test('429 with HTTP-date Retry-After header → parses remaining seconds', async () => {
      const tenSecondsFromNow = new Date(Date.now() + 10_000).toUTCString();
      mockFetchError(429, {}, { 'retry-after': tenSecondsFromNow });
      const err = await client.convertDocument({ template: 'x', convertTo: 'pdf' }).catch((e) => e);
      expect(err).toBeInstanceOf(CarboneRateLimitError);
      // Allow a little slack for clock/rounding (8–10s)
      expect(err.retryAfterSeconds).toBeGreaterThanOrEqual(8);
      expect(err.retryAfterSeconds).toBeLessThanOrEqual(10);
    });

    test('throws CarboneError on 500 — includes API error message', async () => {
      mockFetchError(500, { error: 'Batch processing deactivated. nbReportMaxPerBatch = 0' });
      await expect(
        client.convertDocument({ template: 'x', convertTo: 'pdf' })
      ).rejects.toThrow('Batch processing deactivated');
    });

    test('throws CarboneError on 500 — falls back to the HTTP status when body is empty (shown as temporarily unavailable)', async () => {
      mockFetchError(500, {});
      const err = await client.convertDocument({ template: 'x', convertTo: 'pdf' }).catch((e) => e);
      expect(err).not.toBeInstanceOf(CarboneGenerationError);
      expect(err.message).toBe('HTTP 500 Error');
      expect(formatError(err)).toContain('temporarily unavailable');
    });

    test('throws CarboneError on 502', async () => {
      mockFetchError(502, { error: 'Bad gateway' });
      await expect(client.listTemplates()).rejects.toThrow('Bad gateway');
    });

    test('throws CarboneError on 503', async () => {
      mockFetchError(503, { error: 'Service unavailable' });
      await expect(client.getStatus()).rejects.toThrow('Service unavailable');
    });

    test('throws CarboneError on unexpected status codes', async () => {
      mockFetchError(418, { error: "I'm a teapot" });
      await expect(client.listTemplates()).rejects.toBeInstanceOf(CarboneError);
    });

    test('falls back to statusText when response body is not JSON', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        json: async () => { throw new Error('not json'); },
      } as unknown as Response);

      await expect(client.getStatus()).rejects.toBeInstanceOf(CarboneError);
    });

    test('prefers "error" field over "message" field in error body', async () => {
      mockFetchError(400, { error: 'correct error', message: 'wrong message' });
      const err = await client.convertDocument({ template: 'x', convertTo: 'pdf' })
        .catch((e) => e);
      // 400 with neither 'convertTo' nor 'template' → generic validation error using "error" field
      expect(err.message).toContain('correct error');
    });
  });

  // ── agent-facing error text (buildError → formatError) ───────────────────────

  describe('agent-facing error text', () => {
    /** The text a tool returns for a failed call: formatError of what the client throws. */
    const agentText = (call: Promise<unknown>) => call.then(() => { throw new Error('expected a rejection'); }, formatError);
    const convert = (c: CarboneClient = client) => c.convertDocument({ template: 'x', convertTo: 'pdf' });

    test('400: keeps the API message and code; the matrix link only when about conversion or formats', async () => {
      mockFetchError(400, { success: false, error: '"Content-Type" header is not "application/json"', code: 'w110' });
      const text = await agentText(convert());
      expect(text).toBe('Invalid input (Carbone w110): "Content-Type" header is not "application/json"');

      mockFetchError(400, { success: false, error: 'Invalid convertTo format' });
      const formatText = await agentText(convert());
      expect(formatText).toContain('Invalid convertTo format');
      expect(formatText).toContain('generate-reports.html#output-file-type');
    });

    test('401 in stdio: keeps the API detail and points to CARBONE_API_KEY', async () => {
      mockFetchError(401, { success: false, error: 'Unauthorized Access: The API key or access token has expired.' });
      const text = await agentText(convert(new CarboneClient({ apiKey: 'k', transport: 'stdio' })));
      expect(text).toBe(
        'Authentication failed: Unauthorized Access: The API key or access token has expired. ' +
        'Check the CARBONE_API_KEY environment variable.'
      );
    });

    test('401 in http: points to the Bearer header, never to the env var', async () => {
      mockFetchError(401, { success: false, error: 'Unauthorized, please provide a correct API key', code: 'w120' });
      const text = await agentText(convert(new CarboneClient({ apiKey: 'k', transport: 'http' })));
      expect(text).toBe(
        'Authentication failed (Carbone w120): Unauthorized, please provide a correct API key ' +
        'Send a valid Carbone API key as "Authorization: Bearer <key>".'
      );
      expect(text).not.toContain('CARBONE_API_KEY');
    });

    test('404: keeps the API message and code, and points to the list_templates tool', async () => {
      mockFetchError(404, { success: false, error: 'Template not found', code: 'w100' });
      const text = await agentText(client.downloadTemplate('missing'));
      expect(text).toContain('Not found (Carbone w100): Template not found');
      expect(text).toContain('list_templates tool');
    });

    test('413: keeps the size-limit message and code, with a size hint', async () => {
      mockFetchError(413, { success: false, error: 'Template too large, the file size limit is X Bytes', code: 'w119' });
      const text = await agentText(convert());
      expect(text).toContain('Request too large (Carbone w119): Template too large, the file size limit is X Bytes');
      expect(text).toContain('size limit');
    });

    test('422: keeps the message and code, with a missing-field hint', async () => {
      mockFetchError(422, { success: false, error: '"template" field is empty', code: 'w112' });
      const text = await agentText(convert());
      expect(text).toContain('Missing field (Carbone w112): "template" field is empty');
      expect(text).toContain('missing or empty');
    });

    test('429 with an HTML body (as Carbone Cloud sends it) is a rate-limit error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'content-type': 'text/html', 'retry-after': '12' }),
        json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
      } as unknown as Response);
      expect(await agentText(convert())).toBe('Rate limit exceeded. Please wait 12 second(s) and try again.');
    });

    test('500 w101 (live body): a generation failure caused by the request, with the code and no "try again"', async () => {
      mockFetchError(500, {
        success: false,
        error: 'Unable to generate the document. Error: The HTML document cannot be converted to XLS format with LibreOffice converter',
        code: 'w101',
        data: { renderId: '' },
      });
      const err = await convert().catch((e) => e);
      expect(err).toBeInstanceOf(CarboneGenerationError);
      expect(err.code).toBe('w101');

      const text = formatError(err);
      expect(text).toContain('Document generation failed (Carbone w101): Unable to generate the document.');
      expect(text).toContain('not a Carbone outage');
      expect(text).toContain('generate-reports.html#output-file-type'); // "cannot be converted" → matrix hint
      expect(text).not.toMatch(/try again|temporarily/i);
    });

    test('500 w117 points to the webhook', async () => {
      mockFetchError(500, { success: false, error: 'Error while setting up the webhook', code: 'w117' });
      const text = await agentText(convert());
      expect(text).toContain('Document generation failed (Carbone w117)');
      expect(text).toContain('webhookUrl');
    });

    test('500 with no message, 500 "Server or Database error." and 503 are temporarily unavailable', async () => {
      mockFetchError(500, {});
      expect(await agentText(convert())).toBe('Carbone service temporarily unavailable: HTTP 500 Error\n\nPlease try again in a moment.');

      mockFetchError(500, { success: false, error: 'Server or Database error.' });
      expect(await agentText(client.listTemplates())).toContain('temporarily unavailable: Server or Database error.');

      mockFetchError(503, { success: false, code: 503, message: 'Service cannot execute render' });
      expect(await agentText(client.getStatus())).toBe(
        'Carbone service temporarily unavailable: Service cannot execute render\n\nPlease try again in a moment.'
      );
    });

    test('501 (stateless mode) keeps the message and code, without "try again"', async () => {
      mockFetchError(501, { success: false, error: 'Carbone is running in stateless mode (no database)', code: 'w130' });
      const text = await agentText(client.listTemplates());
      expect(text).toBe('Error (Carbone w130): Carbone is running in stateless mode (no database)');
    });

    test('network failure names the host and the error code, never the key', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
        new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })
      );
      const c = new CarboneClient({ apiKey: 'secret-key-123', baseUrl: 'https://carbone.my-company.com:8443' });
      const err = await convert(c).catch((e) => e);
      expect(err).toBeInstanceOf(CarboneConnectionError);
      const text = formatError(err);
      expect(text).toBe('Could not reach the Carbone API at carbone.my-company.com:8443: ECONNREFUSED.');
      expect(text).not.toContain('secret-key-123');
    });

    test('network failure without a cause code falls back to the error message', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'));
      expect(await agentText(convert())).toBe('Could not reach the Carbone API at api.carbone.io: fetch failed.');
    });
  });

  // ── cancellation (CallOptions.signal) ────────────────────────────────────────

  describe('cancellation signal', () => {
    /** A fetch that never answers and, like the real one, rejects with the signal's reason once it aborts. */
    function hangingFetch() {
      return vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
        const signal = init!.signal!;
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }));
    }

    test('an already-aborted signal aborts the fetch (also through getStatus\'s options spread)', async () => {
      hangingFetch();
      const reason = new Error('cancelled');
      await expect(client.getStatus({ signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    });

    test('aborting the signal mid-call aborts the in-flight fetch', async () => {
      const fetchSpy = hangingFetch();
      const controller = new AbortController();
      const call = client.convertDocument({ template: 'x', convertTo: 'pdf' }, { signal: controller.signal });
      controller.abort(new Error('client disconnected'));
      await expect(call).rejects.toThrow('client disconnected');
      expect(fetchSpy.mock.calls[0][1]!.signal!.aborted).toBe(true);
    });

    test.each([
      ['without a signal', undefined],
      ['with a live signal', new AbortController().signal],
    ])('the timeout still aborts, reported as "timed out after N s" %s', async (_, signal) => {
      hangingFetch();
      const c = new CarboneClient({ apiKey: 'k', timeout: 20 });
      const error = await c.getTags({ signal }).catch((e) => e);
      expect(error).toBeInstanceOf(CarboneConnectionError);
      expect(error.originalError.name).toBe('TimeoutError');
      expect(formatError(error)).toBe('Carbone API request timed out after 0.02 s.');
    });

    test('a cancellation (AbortError) is rethrown as is, not reported as a timeout', async () => {
      hangingFetch();
      const controller = new AbortController();
      const call = client.getTags({ signal: controller.signal });
      controller.abort(); // default reason: an AbortError DOMException
      const error = await call.catch((e) => e);
      expect(error.name).toBe('AbortError');
      expect(error).not.toBeInstanceOf(CarboneConnectionError);
      expect(formatError(error)).not.toContain('timed out');
    });
  });
});
