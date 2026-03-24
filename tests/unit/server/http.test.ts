import { describe, test, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { extractBearerToken, parseBody } from '../../../src/server/http.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal mock IncomingMessage with the given headers. */
function makeReq(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

/**
 * Build a mock streaming IncomingMessage that emits body chunks then ends,
 * or emits an error if `error` is provided.
 */
function makeStreamReq(body: Buffer | null, error?: Error): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  setImmediate(() => {
    if (error) { req.emit('error', error); return; }
    if (body)  req.emit('data', body);
    req.emit('end');
  });
  return req;
}

// ─── extractBearerToken ───────────────────────────────────────────────────────

describe('extractBearerToken', () => {
  test('returns the token from a valid Authorization: Bearer header', () => {
    const req = makeReq({ authorization: 'Bearer my-secret-key' });
    expect(extractBearerToken(req)).toBe('my-secret-key');
  });

  test('returns undefined when there is no Authorization header', () => {
    expect(extractBearerToken(makeReq())).toBeUndefined();
  });

  test('returns undefined when Authorization does not start with "Bearer "', () => {
    expect(extractBearerToken(makeReq({ authorization: 'Basic dXNlcjpwYXNz' }))).toBeUndefined();
    expect(extractBearerToken(makeReq({ authorization: 'Token abc' }))).toBeUndefined();
  });

  test('returns undefined when the token after "Bearer " is empty', () => {
    expect(extractBearerToken(makeReq({ authorization: 'Bearer ' }))).toBeUndefined();
  });

  test('returns undefined when the token is only whitespace', () => {
    expect(extractBearerToken(makeReq({ authorization: 'Bearer   ' }))).toBeUndefined();
  });

  test('trims surrounding whitespace from the token', () => {
    expect(extractBearerToken(makeReq({ authorization: 'Bearer   my-key  ' }))).toBe('my-key');
  });
});

// ─── parseBody ────────────────────────────────────────────────────────────────

describe('parseBody', () => {
  test('resolves undefined for an empty body', async () => {
    const req = makeStreamReq(null);
    await expect(parseBody(req, 1024)).resolves.toBeUndefined();
  });

  test('resolves the parsed JSON object for a valid body', async () => {
    const body = Buffer.from(JSON.stringify({ foo: 'bar' }));
    const req = makeStreamReq(body);
    await expect(parseBody(req, 1024)).resolves.toEqual({ foo: 'bar' });
  });

  test('rejects with "Invalid JSON body" for malformed JSON', async () => {
    const body = Buffer.from('not-json{{{');
    const req = makeStreamReq(body);
    await expect(parseBody(req, 1024)).rejects.toThrow('Invalid JSON body');
  });

  test('rejects with "Request body too large" when body exceeds maxBytes', async () => {
    const body = Buffer.from('x'.repeat(100));
    const req = makeStreamReq(body);
    await expect(parseBody(req, 10)).rejects.toThrow('Request body too large');
  });

  test('rejects when the request stream emits an error', async () => {
    const req = makeStreamReq(null, new Error('socket hang up'));
    await expect(parseBody(req, 1024)).rejects.toThrow('socket hang up');
  });

  test('accepts a body that is exactly at the byte limit', async () => {
    const body = Buffer.from(JSON.stringify({ n: 1 }));
    const req = makeStreamReq(body);
    await expect(parseBody(req, body.length)).resolves.toEqual({ n: 1 });
  });
});
