import { describe, test, expect } from 'vitest';
import {
  CarboneError,
  CarboneAuthError,
  CarboneValidationError,
  CarboneNotFoundError,
  CarboneRateLimitError,
} from '../../../src/carbone/errors.js';

describe('CarboneError', () => {
  test('sets message, statusCode, and name', () => {
    const error = new CarboneError('Something failed', 500);
    expect(error.message).toBe('Something failed');
    expect(error.statusCode).toBe(500);
    expect(error.name).toBe('CarboneError');
    expect(error).toBeInstanceOf(Error);
  });

  test('stores originalError when provided', () => {
    const original = { detail: 'raw' };
    const error = new CarboneError('msg', 400, original);
    expect(error.originalError).toBe(original);
  });

  test('originalError is undefined when not provided', () => {
    const error = new CarboneError('msg', 400);
    expect(error.originalError).toBeUndefined();
  });
});

describe('CarboneAuthError', () => {
  test('uses default message', () => {
    const error = new CarboneAuthError();
    expect(error.message).toBe('Invalid API key');
    expect(error.statusCode).toBe(401);
    expect(error.name).toBe('CarboneAuthError');
  });

  test('accepts custom message', () => {
    const error = new CarboneAuthError('Token expired');
    expect(error.message).toBe('Token expired');
  });

  test('is instanceof CarboneError', () => {
    expect(new CarboneAuthError()).toBeInstanceOf(CarboneError);
  });
});

describe('CarboneValidationError', () => {
  test('sets message, statusCode, and name', () => {
    const error = new CarboneValidationError('Bad format');
    expect(error.message).toBe('Bad format');
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('CarboneValidationError');
  });

  test('is instanceof CarboneError', () => {
    expect(new CarboneValidationError('x')).toBeInstanceOf(CarboneError);
  });
});

describe('CarboneNotFoundError', () => {
  test('stores the full message as-is', () => {
    const error = new CarboneNotFoundError('Template not found');
    expect(error.message).toBe('Template not found');
    expect(error.statusCode).toBe(404);
    expect(error.name).toBe('CarboneNotFoundError');
  });

  test('defaults to "Resource not found"', () => {
    expect(new CarboneNotFoundError().message).toBe('Resource not found');
  });

  test('is instanceof CarboneError', () => {
    expect(new CarboneNotFoundError()).toBeInstanceOf(CarboneError);
  });
});

describe('CarboneRateLimitError', () => {
  test('sets message, statusCode, and name', () => {
    const error = new CarboneRateLimitError();
    expect(error.message).toContain('Rate limit');
    expect(error.statusCode).toBe(429);
    expect(error.name).toBe('CarboneRateLimitError');
  });

  test('is instanceof CarboneError', () => {
    expect(new CarboneRateLimitError()).toBeInstanceOf(CarboneError);
  });
});
