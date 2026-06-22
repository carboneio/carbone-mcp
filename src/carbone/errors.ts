export class CarboneError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'CarboneError';
  }
}

export class CarboneAuthError extends CarboneError {
  constructor(message = 'Invalid API key') {
    super(message, 401);
    this.name = 'CarboneAuthError';
  }
}

export class CarboneValidationError extends CarboneError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'CarboneValidationError';
  }
}

export class CarboneNotFoundError extends CarboneError {
  constructor(message = 'Resource not found') {
    super(message, 404);
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
