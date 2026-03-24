import {
  CarboneAuthError,
  CarboneError,
  CarboneNotFoundError,
  CarboneRateLimitError,
  CarboneValidationError,
} from './errors.js';
import type { ApiStatus, TemplateListItem, UploadTemplateResult } from './types.js';

export interface CarboneClientConfig {
  /** API key for the Carbone API. Optional when using per-call options (e.g. HTTP mode). */
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
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
}

export type OutputFormat = string | { formatName: string; formatOptions?: Record<string, unknown> };

export class CarboneClient {
  static readonly CLOUD_API_URL = 'https://api.carbone.io';

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config: CarboneClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.carbone.io';
    // Carbone API maximum timeout is 60 seconds
    this.timeout = config.timeout ?? 60000;
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
  }, options?: CallOptions): Promise<{ buffer: Buffer; filename: string }> {
    const body: Record<string, unknown> = {
      data: {},
      template: params.template,
      convertTo: params.convertTo,
    };
    if (params.converter) body['converter'] = params.converter;

    const response = await this.request('/render/template?download=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, options);

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
    data: object;
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
  }, options?: CallOptions): Promise<{ buffer: Buffer; filename: string }> {
    const body: Record<string, unknown> = { data: params.data };
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

    const endpoint = params.template
      ? '/render/template?download=true'
      : `/render/${params.templateId}?download=true`;

    const response = await this.request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, options);

    return this.handleBinaryResponse(response);
  }

  /**
   * Upload a template.
   * POST /template
   */
  async uploadTemplate(params: {
    template:   string;
    name:       string;
    id?:        string;
    versioning?: boolean;
    category?:  string;
    comment?:   string;
    tags?:      string[];
    sample?:    Array<{ data: object; complement: object; translations: object; enum: object }>;
    deployedAt?: number;
    expireAt?:   number;
  }, options?: CallOptions): Promise<UploadTemplateResult> {
    const body: Record<string, unknown> = {
      template:   params.template,
      name:       params.name,
      versioning: params.versioning ?? true,
    };
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
   */
  async updateTemplate(params: {
    templateId:  string;
    name?:       string;
    comment?:    string;
    category?:   string;
    tags?:       string[];
    deployedAt?: number;
    expireAt?:   number;
  }, options?: CallOptions): Promise<void> {
    const body: Record<string, unknown> = {};
    if (params.name       !== undefined) body['name']       = params.name;
    if (params.comment    !== undefined) body['comment']    = params.comment;
    if (params.category   !== undefined) body['category']   = params.category;
    if (params.tags       !== undefined) body['tags']       = params.tags;
    if (params.deployedAt !== undefined) body['deployedAt'] = params.deployedAt;
    if (params.expireAt   !== undefined) body['expireAt']   = params.expireAt;

    await this.request(`/template/${params.templateId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, options);
  }

  /**
   * Delete a template (soft delete — sets expireAt to NOW).
   * DELETE /template/{id}
   */
  async deleteTemplate(templateId: string, options?: CallOptions): Promise<void> {
    await this.request(`/template/${templateId}`, { method: 'DELETE' }, options);
  }

  /**
   * Download a template file.
   * GET /template/{id}
   */
  async downloadTemplate(
    templateId: string,
    options?: CallOptions
  ): Promise<{ buffer: Buffer; filename: string }> {
    const response = await this.request(`/template/${templateId}`, {
      method: 'GET',
    }, options);
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
  }, options?: CallOptions): Promise<TemplateListItem[]> {
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

    const json = await response.json() as { data: TemplateListItem[] };
    return json.data;
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

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Resolves the API key to use for a request.
   * Per-call options take priority over the constructor-level key.
   * Throws CarboneAuthError only when targeting the Carbone cloud API without a key —
   * on-premise deployments (custom baseUrl) run without authentication.
   */
  private resolveKey(callOptions?: CallOptions): string | undefined {
    const key = callOptions?.apiKey ?? this.apiKey;
    if (!key && this.baseUrl === CarboneClient.CLOUD_API_URL && !callOptions?.skipAuthCheck) {
      throw new CarboneAuthError(
        'No API key provided. Set CARBONE_API_KEY environment variable or pass apiKey in call options.'
      );
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
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...init,
      headers: {
        ...authHeader,
        'carbone-version': '5',
        ...init.headers,
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      // Non-2xx always returns JSON — parse and throw a typed error
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

  /** Parse a non-2xx response into a typed CarboneError. */
  private async buildError(response: Response): Promise<CarboneError> {
    let body: Record<string, unknown> = {};
    try {
      body = await response.json() as Record<string, unknown>;
    } catch {
      body = { error: response.statusText };
    }

    // Carbone API uses "error" field; fall back to "message" for safety
    const apiError = (body['error'] as string | undefined) ?? (body['message'] as string | undefined);
    const message = apiError ?? 'Unknown error';

    switch (response.status) {
      case 401:
        return new CarboneAuthError(
          'Invalid or expired API key. Please check the CARBONE_API_KEY environment variable.'
        );

      case 404:
        return new CarboneNotFoundError(apiError ?? 'Resource not found');

      case 400:
        if (message.includes('convertTo')) {
          return new CarboneValidationError(
            'Invalid output format. See the conversion matrix: https://carbone.io/documentation/developer/http-api/generate-reports.html#output-file-type'
          );
        }
        return new CarboneValidationError(message);

      case 413:
        return new CarboneError('File too large. Check the Carbone API limits.', 413);

      case 422:
        return new CarboneError(
          `Rendering failed. Check that your template and data are compatible. ${message}`,
          422,
          body
        );

      case 429:
        return new CarboneRateLimitError();

      case 500:
      case 502:
      case 503:
        return new CarboneError(
          apiError ?? 'Carbone service temporarily unavailable. Please try again in a moment.',
          response.status,
          body
        );

      default:
        return new CarboneError(message, response.status, body);
    }
  }
}
