import { describe, test, expect, vi } from 'vitest';
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
function makeStreamReq(body: Buffer | Buffer[] | null, error?: Error): IncomingMessage {
  const req = Object.assign(new EventEmitter(), { pause: vi.fn() }) as unknown as IncomingMessage;
  setImmediate(() => {
    if (error) { req.emit('error', error); return; }
    for (const chunk of Array.isArray(body) ? body : body ? [body] : []) req.emit('data', chunk);
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

  test('is case-insensitive for the Bearer prefix', () => {
    expect(extractBearerToken(makeReq({ authorization: 'bearer my-secret-key' }))).toBe('my-secret-key');
    expect(extractBearerToken(makeReq({ authorization: 'BEARER my-secret-key' }))).toBe('my-secret-key');
    expect(extractBearerToken(makeReq({ authorization: 'Bearer my-secret-key' }))).toBe('my-secret-key');
  });

  test('returns the raw value when no Bearer prefix is present', () => {
    expect(extractBearerToken(makeReq({ authorization: 'my-api-key' }))).toBe('my-api-key');
  });

  test('returns undefined when the token after "Bearer " is empty', () => {
    expect(extractBearerToken(makeReq({ authorization: 'Bearer ' }))).toBeUndefined();
  });

  test('returns undefined when the header is only whitespace', () => {
    expect(extractBearerToken(makeReq({ authorization: '   ' }))).toBeUndefined();
  });

  test('trims surrounding whitespace from the token', () => {
    expect(extractBearerToken(makeReq({ authorization: 'Bearer   my-key  ' }))).toBe('my-key');
    expect(extractBearerToken(makeReq({ authorization: '  my-key  ' }))).toBe('my-key');
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

  test('stops reading as soon as the limit is passed (no draining of the rest)', async () => {
    const req = makeStreamReq([Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8)]);
    await expect(parseBody(req, 10)).rejects.toThrow('Request body too large');
    expect(req.pause).toHaveBeenCalledTimes(1);
    expect(req.listenerCount('data'), 'the data listener is removed at the limit').toBe(0);
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
