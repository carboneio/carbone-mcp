export class CarboneError extends Error {
  constructor(
    message: string,
    /** HTTP status of the Carbone API response; 0 when no response was received (see CarboneConnectionError). */
    public readonly statusCode: number,
    public readonly originalError?: unknown,
    /** Carbone API error code (e.g. "w101"), when the API returned one. */
    public readonly code?: string
  ) {
    super(message);
    this.name = 'CarboneError';
  }
}

export class CarboneAuthError extends CarboneError {
  constructor(message = 'Invalid API key', code?: string) {
    super(message, 401, undefined, code);
    this.name = 'CarboneAuthError';
  }
}

export class CarboneValidationError extends CarboneError {
  constructor(message: string, code?: string) {
    super(message, 400, undefined, code);
    this.name = 'CarboneValidationError';
  }
}

export class CarboneNotFoundError extends CarboneError {
  constructor(message = 'Resource not found', code?: string) {
    super(message, 404, undefined, code);
    this.name = 'CarboneNotFoundError';
  }
}

export class CarboneRateLimitError extends CarboneError {
  /**
   * @param retryAfterSeconds Number of seconds to wait before retrying,
   *   parsed from the `Retry-After` response header when the API provides it.
   */
  constructor(public readonly retryAfterSeconds?: number) {
    super(
      retryAfterSeconds !== undefined
        ? `Rate limit exceeded. Please try again in ${retryAfterSeconds} second(s).`
        : 'Rate limit exceeded. Please try again later.',
      429
    );
    this.name = 'CarboneRateLimitError';
  }
}

/**
 * HTTP 500 with an API message (OpenAPI GenerateReportError, w101 / w117): the document could not be generated
 * because of the request itself (template, data, format/converter, failOn, watermarks, batch options, webhook).
 * Retrying the same request fails again, unlike an outage.
 */
export class CarboneGenerationError extends CarboneError {
  constructor(message: string, code?: string, originalError?: unknown) {
    super(message, 500, originalError, code);
    this.name = 'CarboneGenerationError';
  }
}

/** No HTTP response: the Carbone API could not be reached, or did not answer before the timeout. */
export class CarboneConnectionError extends CarboneError {
  constructor(message: string, originalError?: unknown) {
    super(message, 0, originalError);
    this.name = 'CarboneConnectionError';
  }
}
