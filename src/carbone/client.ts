import {
  CarboneAuthError,
  CarboneConnectionError,
  CarboneError,
  CarboneGenerationError,
  CarboneNotFoundError,
  CarboneRateLimitError,
  CarboneValidationError,
} from './errors.js';
import type {
  ApiStatus, TemplateDebugInfo, TemplateListItem, TemplateListResponse, UpdateTemplateResult, UploadTemplateResult,
} from './types.js';

export interface CarboneClientConfig {
  /** API key for the Carbone API. Optional when using per-call options (e.g. HTTP mode). */
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  transport?: 'stdio' | 'http';
  /**
   * HTTP only: when true, a request without a per-call key (Bearer token) is rejected
   * instead of falling back to the constructor-level apiKey. Prevents anonymous clients
   * from silently spending the operator's key in multi-tenant deployments.
   */
  requireClientAuth?: boolean;
}

/**
 * Per-call authentication options. When provided, these override the constructor-level apiKey.
 * Designed for extensibility: future auth schemes (OAuth2 tokens, etc.) can be added here.
 */
export interface CallOptions {
  /** Carbone API key for this specific call. Overrides the constructor-level apiKey. */
  apiKey?: string;
  /** Skip the API key requirement check. Use for public endpoints that do not require authentication. */
  skipAuthCheck?: boolean;
  /** Aborts the API call (e.g. the MCP request was cancelled); the timeout still applies. */
  signal?: AbortSignal;
}

export type OutputFormat = string | { formatName: string; formatOptions?: Record<string, unknown> };

/**
 * Parse an HTTP `Retry-After` header into a number of seconds.
 * Accepts both forms allowed by the spec: a delta in seconds ("120")
 * or an HTTP-date ("Wed, 21 Oct 2025 07:28:00 GMT"). Returns undefined
 * when the header is absent or unparseable.
 */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
  return undefined;
}

export class CarboneClient {
  static readonly CLOUD_API_URL = 'https://api.carbone.io';

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly transport: 'stdio' | 'http';
  private readonly requireClientAuth: boolean;

  constructor(config: CarboneClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? CarboneClient.CLOUD_API_URL;
    // Carbone API maximum timeout is 60 seconds
    this.timeout = config.timeout ?? 60000;
    this.transport = config.transport ?? 'stdio';
    this.requireClientAuth = config.requireClientAuth ?? false;
  }

  /** True when this client targets the Carbone cloud API (its size limits are enforced by Carbone). */
  get isCloud(): boolean {
    return this.baseUrl === CarboneClient.CLOUD_API_URL;
  }

  /**
   * Public one-time download URL for a renderId (produced by render/convert with returnLink).
   * The endpoint needs no auth; Carbone deletes the file after the first GET.
   */
  renderUrl(renderId: string): string {
    return `${this.baseUrl}/render/${renderId}`;
  }

  /**
   * Convert document without template storage.
   * POST /render/template?download=true
   *
   * Note: `download=true` makes the API stream the file directly.
   * On failure, the API returns a JSON error body — handled in `request()`
   * before `handleBinaryResponse()` is ever called.
   */
  async convertDocument(params: {
    template: string;
    convertTo: OutputFormat;
    converter?: string;
    hardRefresh?: boolean;
    returnLink?: boolean;
    egressAuthorization?: string;
  }, options?: CallOptions): Promise<{ buffer: Buffer; filename: string } | { renderId: string }> {
    // Pure conversion: `data` is deliberately NOT sent, so Carbone (carbone-version 5) skips templating and tags
    // such as {d.name} survive untouched. Sending `data: {}` would run templating against an empty dataset and
    // blank every tag. No reportName either: Carbone resolves it during templating, so a pure conversion ignores
    // it (verified live: the file stays "report.<ext>"); convert_document names the delivered file itself.
    const body: Record<string, unknown> = {
      template: params.template,
      convertTo: params.convertTo,
    };
    if (params.converter)                 body['converter']   = params.converter;
    if (params.hardRefresh !== undefined) body['hardRefresh'] = params.hardRefresh;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Authorize Carbone's egress fetches (external images/PDFs during conversion).
    if (params.egressAuthorization) headers['carbone-egress-header-authorization'] = params.egressAuthorization;

    // Without download=true the API stores the file and returns a renderId (one-time download link).
    const response = await this.request(`/render/template${params.returnLink ? '' : '?download=true'}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, options);

    if (params.returnLink) {
      // request() already threw on any non-2xx (errors are { success:false, error }), so a 200 here
      // always carries data.renderId.
      const json = await response.json() as { data: { renderId: string } };
      return { renderId: json.data.renderId };
    }
    return this.handleBinaryResponse(response);
  }

  /**
   * Generate document from a stored template or an inline base64 template.
   *
   * - Stored template:  POST /render/{templateId}?download=true
   * - Inline template:  POST /render/template?download=true  (template sent as base64 in body)
   *
   * Exactly one of `templateId` or `template` must be provided.
   */
  async renderDocument(params: {
    templateId?: string;
    template?: string;
    data?: object;
    convertTo?: OutputFormat;
    converter?: string;
    timezone?: string;
    lang?: string;
    complement?: Record<string, unknown>;
    variableStr?: string;
    reportName?: string;
    enum?: Record<string, unknown>;
    translations?: Record<string, Record<string, string>>;
    currencySource?: string;
    currencyTarget?: string;
    currencyRates?: Record<string, number>;
    hardRefresh?: boolean;
    batchSplitBy?: string;
    batchOutput?: string;
    batchReportName?: string;
    preReleaseFeatureIn?: number;
    failOn?: string[];
    webhookUrl?: string;
    webhookHeaders?: Record<string, string>;
    keepTags?: boolean;
    returnLink?: boolean;
    egressAuthorization?: string;
  }, options?: CallOptions): Promise<{ buffer: Buffer; filename: string } | { async: true; message: string } | { renderId: string }> {
    // `data` drives the templating pass, so it is always sent: defaulting to {} resolves every tag to an
    // empty string, which is what "render with no data" means. keepTags omits the field entirely instead:
    // from carbone-version 5 that skips templating and leaves every tag intact (proofing a stored template).
    const body: Record<string, unknown> = params.keepTags ? {} : { data: params.data ?? {} };
    if (params.template)                   body['template']       = params.template;
    if (params.convertTo)                  body['convertTo']      = params.convertTo;
    if (params.converter)                  body['converter']      = params.converter;
    if (params.timezone)                   body['timezone']       = params.timezone;
    if (params.lang)                       body['lang']           = params.lang;
    if (params.complement)                 body['complement']     = params.complement;
    if (params.variableStr)                body['variableStr']    = params.variableStr;
    if (params.reportName)                 body['reportName']     = params.reportName;
    if (params.enum)                       body['enum']           = params.enum;
    if (params.translations)               body['translations']   = params.translations;
    if (params.currencySource)             body['currencySource'] = params.currencySource;
    if (params.currencyTarget)             body['currencyTarget'] = params.currencyTarget;
    if (params.currencyRates)              body['currencyRates']  = params.currencyRates;
    if (params.hardRefresh !== undefined)  body['hardRefresh']    = params.hardRefresh;
    if (params.batchSplitBy)               body['batchSplitBy']   = params.batchSplitBy;
    if (params.batchOutput)                body['batchOutput']    = params.batchOutput;
    if (params.batchReportName)            body['batchReportName'] = params.batchReportName;
    if (params.preReleaseFeatureIn !== undefined) body['preReleaseFeatureIn'] = params.preReleaseFeatureIn;
    if (params.failOn)                     body['failOn']         = params.failOn;

    const isAsync = !!params.webhookUrl;
    // returnLink: skip download=true so the API stores the file and returns a renderId (one-time link).
    const wantsLink = !!params.returnLink && !isAsync;
    const stream = !isAsync && !wantsLink;
    const endpoint = params.template
      ? `/render/template${stream ? '?download=true' : ''}`
      : `/render/${encodeURIComponent(params.templateId!)}${stream ? '?download=true' : ''}`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Authorize Carbone's egress fetches — external images, external PDFs (append/attach), and webhooks.
    // For webhook calls specifically, carbone-webhook-header-authorization (below) overrides this.
    if (params.egressAuthorization) headers['carbone-egress-header-authorization'] = params.egressAuthorization;
    if (params.webhookUrl) {
      headers['carbone-webhook-url'] = params.webhookUrl;
      if (params.webhookHeaders) {
        for (const [name, value] of Object.entries(params.webhookHeaders)) {
          headers[`carbone-webhook-header-${name}`] = value;
        }
      }
    }

    const response = await this.request(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, options);

    if (isAsync) {
      const json = await response.json() as { success: boolean; message: string };
      return { async: true, message: json.message };
    }

    if (wantsLink) {
      const json = await response.json() as { data: { renderId: string } };
      return { renderId: json.data.renderId };
    }

    return this.handleBinaryResponse(response);
  }

  /**
   * Inspect a template: the tags it uses and a sample dataset matching its structure.
   *
   * - Stored template:  POST /render/{templateId}
   * - Inline template:  POST /render/template  (template sent as base64 in body)
   *
   * Runs one render with the undocumented `isDebugActive` option, in JSON mode (no `download=true`), so the
   * response carries `data.debug` and the document is left unfetched. No convertTo: the output keeps the
   * template format, the least work for Carbone. Exactly one of `templateId` or `template` must be provided.
   */
  async inspectTemplate(params: { templateId?: string; template?: string }, options?: CallOptions): Promise<TemplateDebugInfo> {
    const body: Record<string, unknown> = { data: {}, isDebugActive: true };
    if (params.template) body['template'] = params.template;
    const endpoint = params.template ? '/render/template' : `/render/${encodeURIComponent(params.templateId!)}`;

    const response = await this.request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, options);

    let debug: unknown;
    try {
      debug = ((await response.json()) as { data?: { debug?: unknown } } | null)?.data?.debug;
    } catch {
      // Not JSON: handled as a missing debug object below.
    }
    if (debug === null || typeof debug !== 'object' || Array.isArray(debug)) {
      throw new CarboneError(
        'This Carbone server returned no inspection data: template inspection needs a more recent Carbone version ' +
        '(Carbone Cloud has it). ' +
        'Read the tags from the template file instead (download_template fetches a stored one).',
        response.status
      );
    }
    return debug as TemplateDebugInfo;
  }

  /**
   * Upload a template.
   * POST /template
   */
  async uploadTemplate(params: {
    template:   string;
    name?:      string;
    id?:        string;
    versioning?: boolean;
    category?:  string;
    comment?:   string;
    tags?:      string[];
    sample?:    Array<{ data?: object; complement?: object; translations?: object; enum?: object }>;
    deployedAt?: number;
    expireAt?:   number;
  }, options?: CallOptions): Promise<UploadTemplateResult> {
    const body: Record<string, unknown> = {
      template:   params.template,
      versioning: params.versioning ?? true,
    };
    if (params.name)       body['name']       = params.name;
    if (params.id)         body['id']         = params.id;
    if (params.category)   body['category']   = params.category;
    if (params.comment)    body['comment']     = params.comment;
    if (params.tags)       body['tags']        = params.tags;
    if (params.sample)     body['sample']      = params.sample;
    if (params.deployedAt !== undefined) body['deployedAt'] = params.deployedAt;
    if (params.expireAt   !== undefined) body['expireAt']   = params.expireAt;

    const response = await this.request('/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, options);

    const json = await response.json() as { data: UploadTemplateResult };
    return json.data;
  }

  /**
   * Update template metadata.
   * PATCH /template/{id}
   * API expects camelCase fields and Unix timestamps (seconds).
   * A Template ID patches its currently deployed version; a Version ID patches that version.
   * Returns the patched versionId plus the fields sent, echoed back by Carbone.
   */
  async updateTemplate(params: {
    templateId:  string;
    id?:         string;
    name?:       string;
    comment?:    string;
    category?:   string;
    tags?:       string[];
    deployedAt?: number;
    expireAt?:   number;
  }, options?: CallOptions): Promise<UpdateTemplateResult> {
    const body: Record<string, unknown> = {};
    if (params.id         !== undefined) body['id']         = params.id;
    if (params.name       !== undefined) body['name']       = params.name;
    if (params.comment    !== undefined) body['comment']    = params.comment;
    if (params.category   !== undefined) body['category']   = params.category;
    if (params.tags       !== undefined) body['tags']       = params.tags;
    if (params.deployedAt !== undefined) body['deployedAt'] = params.deployedAt;
    if (params.expireAt   !== undefined) body['expireAt']   = params.expireAt;

    const response = await this.request(`/template/${encodeURIComponent(params.templateId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, options);

    const json = await response.json() as { data: UpdateTemplateResult };
    return json.data;
  }

  /**
   * Delete a template (soft delete — sets expireAt to NOW): it stops being listed, downloaded or rendered
   * immediately, and the file is purged after the server's retention delay.
   * DELETE /template/{id}
   */
  async deleteTemplate(templateId: string, options?: CallOptions): Promise<void> {
    await this.request(`/template/${encodeURIComponent(templateId)}`, { method: 'DELETE' }, options);
  }

  /**
   * Download a template file, or with `sample` the JSON sample dataset stored with it.
   * GET /template/{id}  |  GET /template/{id}_sample.json
   */
  async downloadTemplate(
    templateId: string,
    options?: CallOptions & { sample?: boolean }
  ): Promise<{ buffer: Buffer; filename: string }> {
    // The sample dataset uploaded alongside a template is served from the same path with a
    // "_sample.json" suffix. The id itself is encoded; the suffix is ours, so it stays outside.
    const path = `/template/${encodeURIComponent(templateId)}${options?.sample ? '_sample.json' : ''}`;
    const response = await this.request(path, { method: 'GET' }, options);
    return this.handleBinaryResponse(response);
  }

  /**
   * List templates.
   * GET /templates
   */
  async listTemplates(params?: {
    id?:              string;
    versionId?:       string;
    category?:        string;
    origin?:          number;
    includeVersions?: boolean;
    search?:          string;
    limit?:           number;
    cursor?:          string;
  }, options?: CallOptions): Promise<TemplateListResponse> {
    const query = new URLSearchParams();
    if (params?.id)                            query.set('id',              params.id);
    if (params?.versionId)                     query.set('versionId',       params.versionId);
    if (params?.category)                      query.set('category',        params.category);
    if (params?.origin !== undefined)          query.set('origin',          String(params.origin));
    if (params?.includeVersions !== undefined) query.set('includeVersions', String(params.includeVersions));
    if (params?.search)                        query.set('search',          params.search);
    if (params?.limit)                         query.set('limit',           String(params.limit));
    if (params?.cursor)                        query.set('cursor',          params.cursor);

    const url = `/templates${query.size ? `?${query}` : ''}`;
    const response = await this.request(url, { method: 'GET' }, options);

    const json = await response.json() as { data: TemplateListItem[], hasMore: boolean, nextCursor?: string };
    return { templates: json.data, hasMore: json.hasMore ?? false, nextCursor: json.nextCursor };
  }

  /**
   * List all template categories.
   * GET /templates/categories
   * OpenAPI: data is [{ name: string }], not string[]
   */
  async getCategories(options?: CallOptions): Promise<string[]> {
    const response = await this.request('/templates/categories', {
      method: 'GET',
    }, options);
    const json = await response.json() as { data: { name: string }[] };
    return json.data.map((item) => item.name);
  }

  /**
   * List all template tags.
   * GET /templates/tags
   * OpenAPI: data is [{ name: string }], not string[]
   */
  async getTags(options?: CallOptions): Promise<string[]> {
    const response = await this.request('/templates/tags', { method: 'GET' }, options);
    const json = await response.json() as { data: { name: string }[] };
    return json.data.map((item) => item.name);
  }

  /**
   * Get API status.
   * GET /status
   * OpenAPI: { success, code, message, version } — flat, no data wrapper
   */
  async getStatus(options?: CallOptions): Promise<ApiStatus> {
    const response = await this.request('/status', { method: 'GET' }, { ...options, skipAuthCheck: true });
    const json = await response.json() as { version: string; message: string };
    return { version: json.version, message: json.message };
  }

  /**
   * Throw the same CarboneAuthError an authenticated call would, without making any request.
   * Handlers call this BEFORE resolving caller-supplied inputs (URLs, paths, by-reference JSON), so a
   * caller who cannot authenticate cannot make the server download anything. Always enforced, even if
   * skipAuthCheck is set.
   */
  assertCanAuthenticate(callOptions?: CallOptions): void {
    this.resolveKey({ ...callOptions, skipAuthCheck: false });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Resolves the API key to use for a request.
   * Per-call options take priority over the constructor-level key.
   * Throws CarboneAuthError only when targeting the Carbone cloud API without a key —
   * on-premise deployments (custom baseUrl) run without authentication.
   */
  private resolveKey(callOptions?: CallOptions): string | undefined {
    const perCallKey = callOptions?.apiKey;
    const key = perCallKey ?? this.apiKey;

    if (!callOptions?.skipAuthCheck) {
      // Reject (rather than fall back to the server key) when the operator requires a
      // per-request key in multi-tenant HTTP mode — even if a constructor-level key is set.
      const missingRequiredClientKey = this.requireClientAuth && this.transport === 'http' && !perCallKey;
      const missingCloudKey = !key && this.baseUrl === CarboneClient.CLOUD_API_URL;
      if (missingRequiredClientKey || missingCloudKey) {
        throw new CarboneAuthError(
          this.transport === 'http'
            ? 'No API key provided. Pass your Carbone API key as a Bearer token in the Authorization header: Authorization: Bearer <your-key>. Get yours at https://account.carbone.io'
            : 'No API key provided. Set the CARBONE_API_KEY environment variable. Get yours at https://account.carbone.io'
        );
      }
    }
    return key || undefined;
  }

  /**
   * Core HTTP helper. Adds auth headers and throws a typed CarboneError on
   * any non-2xx response (including JSON error bodies returned on binary endpoints).
   * The Authorization header is omitted when no key is resolved (on-premise deployments).
   */
  private async request(
    endpoint: string,
    init: RequestInit,
    callOptions?: CallOptions
  ): Promise<Response> {
    const key = this.resolveKey(callOptions);
    const authHeader: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
    // The signal also covers reading the response body (binary downloads included).
    const timeout = AbortSignal.timeout(this.timeout);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...init,
        headers: {
          ...authHeader,
          'carbone-version': '5',
          ...init.headers,
        },
        signal: callOptions?.signal ? AbortSignal.any([timeout, callOptions.signal]) : timeout,
      });
    } catch (err) {
      // Cancelled by the MCP client: rethrow as is (the result is discarded), never report it as a timeout.
      if (callOptions?.signal?.aborted) throw err;
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new CarboneConnectionError(`Carbone API request timed out after ${this.timeout / 1000} s.`, err);
      }
      // Network failure: name the host and the system error code only (no URL path, headers or key).
      const reason = (err as { cause?: { code?: string } } | undefined)?.cause?.code ?? (err instanceof Error ? err.message : String(err));
      throw new CarboneConnectionError(`Could not reach the Carbone API at ${new URL(this.baseUrl).host}: ${reason}.`, err);
    }

    if (!response.ok) {
      // Non-2xx: parse the JSON error body (when there is one) and throw a typed error
      throw await this.buildError(response);
    }

    return response;
  }

  /** Extract buffer + filename from a successful binary (file stream) response. */
  private async handleBinaryResponse(
    response: Response
  ): Promise<{ buffer: Buffer; filename: string }> {
    const contentDisposition = response.headers.get('content-disposition');
    // Handles both quoted and unquoted filenames: filename="foo.pdf" or filename=foo.pdf
    const match = contentDisposition?.match(/filename\*?=["']?([^"';\r\n]+)["']?/i);
    const filename = match?.[1]?.trim() ?? 'document';

    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, filename };
  }

  /**
   * Parse a non-2xx response into a typed CarboneError that keeps the API's own message and code (wNNN).
   * Presentation (labels, hints) is formatError's job; only the 401 advice is added here, as it depends on the transport.
   */
  private async buildError(response: Response): Promise<CarboneError> {
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json() ?? {}) as Record<string, unknown>;
    } catch {
      // Non-JSON body (e.g. the HTML page of a 429): only the status is usable.
    }

    // Carbone API uses "error" field; fall back to "message" (GET /status 503)
    const apiError = (body['error'] as string | undefined) ?? (body['message'] as string | undefined);
    const code = typeof body['code'] === 'string' ? body['code'] : undefined;
    const message = apiError ?? `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;

    switch (response.status) {
      case 401:
        return new CarboneAuthError(
          `${apiError ?? 'Invalid or expired API key.'} ` +
          (this.transport === 'http'
            ? 'Send a valid Carbone API key as "Authorization: Bearer <key>".'
            : 'Check the CARBONE_API_KEY environment variable.'),
          code
        );

      case 404:
        return new CarboneNotFoundError(apiError ?? 'Resource not found', code);

      case 400:
        return new CarboneValidationError(message, code);

      case 429:
        return new CarboneRateLimitError(parseRetryAfter(response.headers.get('retry-after')));

      case 500:
        // A 500 with an API message is a generation failure caused by the request (GenerateReportError w101/w117),
        // except the generic ServerOrDatabaseError of the template endpoints, which is a real server fault.
        if (apiError && !/^Server or Database error/i.test(apiError)) {
          return new CarboneGenerationError(apiError, code, body);
        }
        break;
    }
    return new CarboneError(message, response.status, body, code);
  }
}
