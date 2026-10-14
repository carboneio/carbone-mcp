import {
  CarboneAuthError,
  CarboneConnectionError,
  CarboneError,
  CarboneGenerationError,
  CarboneNotFoundError,
  CarboneRateLimitError,
  CarboneValidationError,
} from '../carbone/errors.js';

const CONVERSION_MATRIX = 'https://carbone.io/documentation/developer/http-api/generate-reports.html#output-file-type';

/** " (Carbone w101)" when the API returned an error code. */
const codeOf = (error: CarboneError) => (error.code ? ` (Carbone ${error.code})` : '');

/**
 * Converts any thrown error into a clear, actionable message for AI assistants:
 * the API's own message and code, plus a hint on what to fix (or whether retrying can help).
 */
export function formatError(error: unknown): string {
  if (error instanceof CarboneAuthError) {
    // The message already carries the transport-specific advice (env var in stdio, Bearer header in HTTP).
    return `Authentication failed${codeOf(error)}: ${error.message}`;
  }

  if (error instanceof CarboneValidationError) {
    return (
      `Invalid input${codeOf(error)}: ${error.message}` +
      (/convert|format/i.test(error.message) ? `\n\nValid outputs depend on the input format: ${CONVERSION_MATRIX}` : '')
    );
  }

  if (error instanceof CarboneNotFoundError) {
    return (
      `Not found${codeOf(error)}: ${error.message}\n\n` +
      'Check the ID with the list_templates tool (or the carbone://templates resource).'
    );
  }

  if (error instanceof CarboneRateLimitError) {
    return error.retryAfterSeconds !== undefined
      ? `Rate limit exceeded. Please wait ${error.retryAfterSeconds} second(s) and try again.`
      : 'Rate limit exceeded. Please wait a moment and try again.';
  }

  if (error instanceof CarboneGenerationError) {
    const hint =
      error.code === 'w117' ? 'Check webhookUrl and webhookHeaders: the webhook could not be set up with them.'
      : /can(?:not|'t) be converted/i.test(error.message)
        ? `This input format cannot be converted to the requested convertTo with this converter: check the conversion matrix (${CONVERSION_MATRIX}) or change the converter.`
      : 'Check the template syntax, the data, the convertTo / converter combination, failOn, watermarks (max 4) and batch options.';
    return (
      `Document generation failed${codeOf(error)}: ${error.message}\n\n` +
      `The request caused this error, not a Carbone outage: sending it again unchanged fails the same way. ${hint}`
    );
  }

  if (error instanceof CarboneConnectionError) {
    return error.message;
  }

  if (error instanceof CarboneError) {
    switch (error.statusCode) {
      case 413:
        return `Request too large${codeOf(error)}: ${error.message}\n\n` +
          'The template file or the JSON data exceeds the Carbone size limit: send a smaller file or less data.';
      case 422:
        return `Missing field${codeOf(error)}: ${error.message}\n\n` +
          'A required field of the request is missing or empty (e.g. an empty template file).';
      case 500: // without an API message (see CarboneGenerationError)
      case 502:
      case 503:
      case 504:
        return `Carbone service temporarily unavailable${codeOf(error)}: ${error.message}\n\nPlease try again in a moment.`;
    }
    return `Error${codeOf(error)}: ${error.message}`;
  }

  // A timeout while reading the response body (after the request itself succeeded).
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'Carbone API request timed out.';
  }

  return `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
}
