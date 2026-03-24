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
  constructor() {
    super('Rate limit exceeded. Please try again later.', 429);
    this.name = 'CarboneRateLimitError';
  }
}
