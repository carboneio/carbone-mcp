import { describe, test, expect } from 'vitest';
import { formatError } from '../../../src/utils/errors.js';
import {
  CarboneAuthError,
  CarboneConnectionError,
  CarboneError,
  CarboneGenerationError,
  CarboneNotFoundError,
  CarboneRateLimitError,
  CarboneValidationError,
} from '../../../src/carbone/errors.js';

describe('formatError', () => {
  test('formats CarboneAuthError without appending transport-specific advice (the message carries it)', () => {
    const result = formatError(new CarboneAuthError());
    expect(result).toBe('Authentication failed: Invalid API key');
    expect(result).not.toContain('CARBONE_API_KEY');
  });

  test('formats CarboneAuthError with custom message', () => {
    const result = formatError(new CarboneAuthError('Token expired'));
    expect(result).toContain('Token expired');
  });

  test('formats CarboneValidationError', () => {
    const result = formatError(new CarboneValidationError('Invalid format'));
    expect(result).toContain('Invalid input');
    expect(result).toContain('Invalid format');
    expect(result).toContain('carbone.io');
  });

  test('formats CarboneNotFoundError', () => {
    const result = formatError(new CarboneNotFoundError('Template not found'));
    expect(result).toContain('Not found');
    expect(result).toContain('Template not found');
    expect(result).toContain('carbone://templates');
  });

  test('formats CarboneRateLimitError', () => {
    const result = formatError(new CarboneRateLimitError());
    expect(result).toContain('Rate limit exceeded');
  });

  test('formats CarboneRateLimitError with a retry-after delay', () => {
    const result = formatError(new CarboneRateLimitError(45));
    expect(result).toContain('Rate limit exceeded');
    expect(result).toContain('45');
  });

  test('formats a 502/503/504 CarboneError as temporarily unavailable', () => {
    for (const status of [502, 503, 504]) {
      const result = formatError(new CarboneError('Service down', status));
      expect(result).toBe('Carbone service temporarily unavailable: Service down\n\nPlease try again in a moment.');
    }
  });

  test('formats CarboneGenerationError as a request-caused failure with its code, never "try again"', () => {
    const result = formatError(new CarboneGenerationError('Unable to generate the document. Error: bad tag', 'w101'));
    expect(result).toContain('Document generation failed (Carbone w101): Unable to generate the document. Error: bad tag');
    expect(result).toContain('template syntax');
    expect(result).not.toContain('generate-reports.html'); // matrix hint only for "cannot be converted"
    expect(result).not.toMatch(/try again|temporarily/i);
  });

  test('formats CarboneConnectionError as its own message', () => {
    expect(formatError(new CarboneConnectionError('Carbone API request timed out after 60 s.'))).toBe(
      'Carbone API request timed out after 60 s.'
    );
  });

  test('formats a timeout while reading the response body', () => {
    const error = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    expect(formatError(error)).toBe('Carbone API request timed out.');
  });

  test('includes the API code for any CarboneError', () => {
    expect(formatError(new CarboneValidationError('Invalid template metadata', 'w124'))).toBe(
      'Invalid input (Carbone w124): Invalid template metadata'
    );
  });

  test('formats CarboneError with 4xx status as non-temporary', () => {
    const result = formatError(new CarboneError('Bad request', 400));
    expect(result).toContain('Error');
    expect(result).not.toContain('temporary');
  });

  test('formats standard Error', () => {
    const result = formatError(new Error('Something broke'));
    expect(result).toContain('Unexpected error');
    expect(result).toContain('Something broke');
  });

  test('formats non-Error values', () => {
    const result = formatError('plain string error');
    expect(result).toContain('Unexpected error');
    expect(result).toContain('plain string error');
  });
});
