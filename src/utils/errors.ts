import {
  CarboneAuthError,
  CarboneError,
  CarboneNotFoundError,
  CarboneRateLimitError,
  CarboneValidationError,
} from '../carbone/errors.js';

/**
 * Converts any thrown error into a clear, actionable message for AI assistants.
 */
export function formatError(error: unknown): string {
  if (error instanceof CarboneAuthError) {
    return (
      `Authentication failed: ${error.message}\n\n` +
      'Please verify that CARBONE_API_KEY is set correctly in the environment.'
    );
  }

  if (error instanceof CarboneValidationError) {
    return (
      `Invalid input: ${error.message}\n\n` +
      'For valid formats and parameters, refer to: https://carbone.io/file/carbone.OpenAPI.yml'
    );
  }

  if (error instanceof CarboneNotFoundError) {
    return (
      `Not found: ${error.message}\n\n` +
      'Use the carbone://templates resource to browse available templates.'
    );
  }

  if (error instanceof CarboneRateLimitError) {
    return 'Rate limit exceeded. Please wait a moment and try again.';
  }

  if (error instanceof CarboneError) {
    if (error.statusCode >= 500) {
      return `Carbone service error: ${error.message}`;
    }
    return `Error: ${error.message}`;
  }

  return `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
}
