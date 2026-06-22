import { describe, test, expect } from 'vitest';
import { formatError } from '../../../src/utils/errors.js';
import {
  CarboneAuthError,
  CarboneError,
  CarboneNotFoundError,
  CarboneRateLimitError,
  CarboneValidationError,
} from '../../../src/carbone/errors.js';

describe('formatError', () => {
  test('formats CarboneAuthError', () => {
    const result = formatError(new CarboneAuthError());
    expect(result).toContain('Authentication failed');
    expect(result).toContain('CARBONE_API_KEY');
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

  test('formats CarboneError with 5xx status', () => {
    const result = formatError(new CarboneError('Service down', 503));
    expect(result).toContain('Carbone service error');
    expect(result).toContain('Service down');
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
