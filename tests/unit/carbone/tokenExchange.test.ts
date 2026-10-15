import { describe, test, expect, vi, afterEach } from 'vitest';
import {
  ACCESS_TOKEN_TYPE,
  AuthorizationServerUnavailableError,
  Backoff,
  SubjectTokenRejectedError,
  TOKEN_EXCHANGE_GRANT_TYPE,
  TokenExchange,
  postToAuthorizationServer,
  untilAborted,
} from '../../../src/carbone/tokenExchange.js';
import { CarboneClient, callOptionsFrom } from '../../../src/carbone/client.js';
import { CarboneAuthError } from '../../../src/carbone/errors.js';
import { LruCache, tokenCacheKey } from '../../../src/utils/lru.js';

/**
 * RFC 8693 exchange client (stubbed fetch, never the network), and the Carbone client's single retry with a
 * freshly exchanged key after a 401.
 */

const TOKEN_ENDPOINT = 'https://account.example.test/api/oauth/token';
const CREDENTIALS = { clientId: 'mcp-server', clientSecret: 's3cr:t+/=' };

type Call = { url: string; headers: Headers; form: URLSearchParams };

/** A fetch stub answering each call with the next response, recording what was sent. */
function stubFetch(...responses: Array<Response | Error | (() => Response)>) {
  const calls: Call[] = [];
  const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), form: new URLSearchParams(String(init?.body)) });
    const next = responses.length > 1 ? responses.shift()! : responses[0];
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next.clone();
  });
  return { fetch: fetchStub as unknown as typeof fetch, calls };
}

const exchanged = (accessToken: string, expiresIn = 900) => Response.json({
  access_token: accessToken, issued_token_type: ACCESS_TOKEN_TYPE, token_type: 'Bearer', expires_in: expiresIn, scope: 'doc_rwd',
});
const oauthError = (status: number, error: string, headers?: HeadersInit) =>
  Response.json({ error, error_description: 'refused' }, { status, headers });

function newExchange(fetchStub: typeof fetch, clock = { now: 1_000_000 }, maxEntries?: number) {
  return new TokenExchange({ tokenEndpoint: TOKEN_ENDPOINT, credentials: CREDENTIALS, fetch: fetchStub, now: () => clock.now, maxEntries });
}

describe('TokenExchange', () => {
  test('posts the RFC 8693 form with client_secret_basic, and returns the access token', async () => {
    const { fetch, calls } = stubFetch(exchanged('jwt-1'));
    await expect(newExchange(fetch).exchange('opaque-subject')).resolves.toBe('jwt-1');

    expect(calls).toHaveLength(1);
    const [{ url, headers, form }] = calls;
    expect(url).toBe(TOKEN_ENDPOINT);
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(form)).toEqual({
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      subject_token: 'opaque-subject',
      subject_token_type: ACCESS_TOKEN_TYPE,
      requested_token_type: ACCESS_TOKEN_TYPE,
    });
    // RFC 6749 §2.3.1: id and secret are form-encoded, then joined with ":" and base64-encoded.
    const [id, secret] = Buffer.from(headers.get('authorization')!.replace(/^Basic /, ''), 'base64').toString().split(':');
    expect(decodeURIComponent(id)).toBe(CREDENTIALS.clientId);
    expect(decodeURIComponent(secret.replace(/\+/g, ' '))).toBe(CREDENTIALS.clientSecret);
  });

  test('reuses the JWT until 30 s before it expires, then exchanges once more', async () => {
    const clock = { now: 1_000_000 };
    const { fetch, calls } = stubFetch(exchanged('jwt-1'), exchanged('jwt-2'));
    const exchange = newExchange(fetch, clock);
    await exchange.exchange('subject');
    clock.now += 869_000;
    await expect(exchange.exchange('subject')).resolves.toBe('jwt-1');
    expect(calls).toHaveLength(1);
    clock.now += 2_000; // past expires_in (900 s) - 30 s
    await expect(exchange.exchange('subject')).resolves.toBe('jwt-2');
    expect(calls).toHaveLength(2);
  });

  test('a JWT expiring within the 30 s margin is not cached; an expires_in that is no number is kept a minute', async () => {
    const clock = { now: 1_000_000 };
    const { fetch, calls } = stubFetch(exchanged('jwt-1', 10), exchanged('jwt-2', 30), Response.json({ access_token: 'jwt-3', expires_in: null }));
    const exchange = newExchange(fetch, clock);
    await exchange.exchange('subject');
    await exchange.exchange('subject');
    expect([calls.length, exchange.cacheSize]).toEqual([2, 0]);
    await expect(exchange.exchange('subject')).resolves.toBe('jwt-3');
    await expect(exchange.exchange('subject')).resolves.toBe('jwt-3');
    expect(calls).toHaveLength(3);
    clock.now += 60_000;
    expect(exchange.cacheSize).toBe(1);
    await exchange.exchange('subject');
    expect(calls).toHaveLength(4);
  });

  test('a token whose exchange failed is asked again only after its Retry-After, however often its client retries', async () => {
    const clock = { now: 1_000_000 };
    const { fetch, calls } = stubFetch(oauthError(500, 'server_error'), exchanged('jwt-1'));
    const exchange = newExchange(fetch, clock);
    for (let i = 0; i < 200; i++) await expect(exchange.exchange('subject')).rejects.toMatchObject({ retryAfterSeconds: 5 });
    expect(calls).toHaveLength(1);
    await expect(exchange.exchange('another-subject')).resolves.toBe('jwt-1');
    clock.now += 5_000;
    await exchange.exchange('subject');
    expect(calls).toHaveLength(3);
  });

  test('an exchange answered 429 pauses every call; a 5xx fails that exchange only', async () => {
    const backoff = new Backoff();
    const { fetch } = stubFetch(oauthError(500, 'server_error'), oauthError(429, 'too_many_requests', { 'Retry-After': '20' }));
    const exchange = new TokenExchange({ tokenEndpoint: TOKEN_ENDPOINT, credentials: CREDENTIALS, fetch, backoff });
    await expect(exchange.exchange('one-account')).rejects.toBeInstanceOf(AuthorizationServerUnavailableError);
    expect(backoff.active).toBe(false);
    await expect(exchange.exchange('another-account')).rejects.toMatchObject({ retryAfterSeconds: 20 });
    expect(backoff.active).toBe(true);
  });

  test('concurrent calls for one subject token share one in-flight exchange', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetchStub = vi.fn(async () => { await gate; return exchanged('jwt-1'); });
    const exchange = newExchange(fetchStub as unknown as typeof fetch);
    const results = Promise.all([1, 2, 3].map(() => exchange.exchange('subject')));
    release();
    await expect(results).resolves.toEqual(['jwt-1', 'jwt-1', 'jwt-1']);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  test('a caller that aborts stops waiting, but the shared exchange completes and is cached', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetchStub = vi.fn(async () => { await gate; return exchanged('jwt-1'); });
    const exchange = newExchange(fetchStub as unknown as typeof fetch);
    const controller = new AbortController();
    const abandoned = exchange.exchange('subject', controller.signal);
    const waiting = exchange.exchange('subject');
    controller.abort(new Error('client went away'));
    await expect(abandoned).rejects.toThrow('client went away');
    release();
    await expect(waiting).resolves.toBe('jwt-1');
    await expect(exchange.exchange('subject')).resolves.toBe('jwt-1');
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  test('invalidate forgets the cached JWT; with a stale key, only while it is still the cached one', async () => {
    const { fetch, calls } = stubFetch(exchanged('jwt-1'), exchanged('jwt-2'), exchanged('jwt-3'));
    const exchange = newExchange(fetch);
    await exchange.exchange('subject');
    exchange.invalidate('subject', 'jwt-1');
    await expect(exchange.exchange('subject')).resolves.toBe('jwt-2');
    exchange.invalidate('subject', 'jwt-1'); // a concurrent call refused with the old JWT: jwt-2 stays
    await expect(exchange.exchange('subject')).resolves.toBe('jwt-2');
    exchange.invalidate('subject');
    await expect(exchange.exchange('subject')).resolves.toBe('jwt-3');
    expect(calls).toHaveLength(3);
  });

  test('a renewed JWT refused again within a minute is not renewed again: invalidate says false and keeps it', async () => {
    const clock = { now: 1_000_000 };
    const { fetch, calls } = stubFetch(exchanged('jwt-1'), exchanged('jwt-2'), exchanged('jwt-3'));
    const exchange = newExchange(fetch, clock);
    await exchange.exchange('subject');
    expect(exchange.invalidate('subject', 'jwt-1')).toBe(true);
    await expect(exchange.exchange('subject')).resolves.toBe('jwt-2');
    expect(exchange.invalidate('subject', 'jwt-2')).toBe(false);
    await expect(exchange.exchange('subject')).resolves.toBe('jwt-2');
    clock.now += 60_000;
    expect(exchange.invalidate('subject', 'jwt-2')).toBe(true);
    await expect(exchange.exchange('subject')).resolves.toBe('jwt-3');
    expect(calls).toHaveLength(3);
  });

  test('an answer without expires_in is kept a minute; the renewal limit holds even when nothing is cached', async () => {
    const clock = { now: 1_000_000 };
    const { fetch, calls } = stubFetch(Response.json({ access_token: 'jwt-1' }), Response.json({ access_token: 'jwt-2' }), exchanged('jwt-3', 20));
    const exchange = newExchange(fetch, clock);
    await exchange.exchange('subject');
    await expect(exchange.exchange('subject')).resolves.toBe('jwt-1');
    expect(calls).toHaveLength(1);
    clock.now += 60_000;
    await expect(exchange.exchange('subject')).resolves.toBe('jwt-2');
    expect(exchange.invalidate('subject', 'jwt-2')).toBe(true);
    await expect(exchange.exchange('subject')).resolves.toBe('jwt-3'); // expires in 20 s: not kept
    expect(exchange.invalidate('subject', 'jwt-3')).toBe(false);
  });

  test('a refused subject token is refused again for a minute without a request', async () => {
    const clock = { now: 1_000_000 };
    const { fetch, calls } = stubFetch(oauthError(400, 'invalid_request'), exchanged('jwt-1'));
    const exchange = newExchange(fetch, clock);
    await expect(exchange.exchange('subject')).rejects.toMatchObject({ repeated: false });
    await expect(exchange.exchange('subject')).rejects.toMatchObject({ repeated: true, oauthError: 'invalid_request' });
    expect(calls).toHaveLength(1);
    clock.now += 60_000;
    await expect(exchange.exchange('subject')).resolves.toBe('jwt-1');
  });

  test('a caller that stopped waiting leaves no unhandled rejection when the exchange then fails', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { fetch } = stubFetch(oauthError(500, 'server_error'));
      await expect(newExchange(fetch).exchange('subject', AbortSignal.abort(new Error('client went away')))).rejects.toThrow('client went away');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  test('the cache is a bounded LRU keyed by the SHA-256 of the subject token', async () => {
    const { fetch } = stubFetch(() => exchanged('jwt'));
    const exchange = newExchange(fetch, undefined, 3);
    for (let i = 0; i < 10; i++) await exchange.exchange(`subject-${i}`);
    expect(exchange.cacheSize).toBe(3);
    const keys = [...exchange['cache'].keys()];
    expect(keys).toEqual(['subject-7', 'subject-8', 'subject-9'].map(tokenCacheKey));
  });

  test('a test_ JWT is returned as is', async () => {
    const { fetch } = stubFetch(exchanged('test_eyJhbGciOiJFUzUxMiJ9.e30.c2ln'));
    await expect(newExchange(fetch).exchange('subject')).resolves.toBe('test_eyJhbGciOiJFUzUxMiJ9.e30.c2ln');
  });

  test.each(['invalid_request', 'invalid_grant'])('400 %s: the subject token is rejected (the client signs in again)', async (error) => {
    const { fetch } = stubFetch(oauthError(400, error));
    const err = await newExchange(fetch).exchange('subject').catch((e) => e);
    expect(err).toBeInstanceOf(SubjectTokenRejectedError);
    expect(err.oauthError).toBe(error);
  });

  test.each([
    [401, 'invalid_client'],
    [400, 'unauthorized_client'],
    [400, 'invalid_target'],
    [400, 'invalid_scope'],
    [500, 'server_error'],
  ])('HTTP %i %s is this server\'s problem: unavailable, never a rejected token', async (status, error) => {
    const { fetch } = stubFetch(oauthError(status, error));
    const err = await newExchange(fetch).exchange('subject').catch((e) => e);
    expect(err).toBeInstanceOf(AuthorizationServerUnavailableError);
    expect(err.message).toBe(`Token exchange failed: HTTP ${status} ${error}`);
    expect(err.retryAfterSeconds).toBe(5);
  });

  test('an error answer without an error code is still "unavailable"', async () => {
    const { fetch } = stubFetch(Response.json({}, { status: 500 }));
    await expect(newExchange(fetch).exchange('subject')).rejects.toThrow(/^Token exchange failed: HTTP 500$/);
  });

  test('429 carries the authorization server\'s Retry-After', async () => {
    const { fetch } = stubFetch(oauthError(429, 'too_many_requests', { 'Retry-After': '42' }));
    const err = await newExchange(fetch).exchange('subject').catch((e) => e);
    expect(err).toBeInstanceOf(AuthorizationServerUnavailableError);
    expect(err.retryAfterSeconds).toBe(42);
  });

  test('a failed exchange is not cached: the first call after its Retry-After tries again', async () => {
    const clock = { now: 1_000_000 };
    const { fetch, calls } = stubFetch(oauthError(503, 'temporarily_unavailable'), exchanged('jwt-1'));
    const exchange = newExchange(fetch, clock);
    await expect(exchange.exchange('subject')).rejects.toBeInstanceOf(AuthorizationServerUnavailableError);
    clock.now += 5_000;
    await expect(exchange.exchange('subject')).resolves.toBe('jwt-1');
    expect(calls).toHaveLength(2);
  });
});

describe('postToAuthorizationServer', () => {
  test('a network error is "unreachable", naming the endpoint and the error code only', async () => {
    const { fetch } = stubFetch(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
    const err = await postToAuthorizationServer(TOKEN_ENDPOINT, { subject_token: 'secret-subject' }, CREDENTIALS, fetch).catch((e) => e);
    expect(err).toBeInstanceOf(AuthorizationServerUnavailableError);
    expect(err.message).toBe('Authorization server /api/oauth/token unreachable: ECONNREFUSED');
    expect(err.message).not.toContain('secret');
  });

  test('a non-Error rejection is "unreachable" too', async () => {
    const fetchStub = vi.fn(async () => { throw 'boom'; }) as unknown as typeof fetch;
    await expect(postToAuthorizationServer(TOKEN_ENDPOINT, {}, CREDENTIALS, fetchStub)).rejects.toThrow('unreachable: boom');
  });

  test('every call gives up after 10 s', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      const fetchStub = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.signal).toBe(timeout.mock.results[0]?.value);
        return Response.json({ active: false });
      }) as unknown as typeof fetch;
      await postToAuthorizationServer(TOKEN_ENDPOINT, {}, CREDENTIALS, fetchStub);
      expect(timeout).toHaveBeenCalledWith(10_000);
      expect(fetchStub).toHaveBeenCalledOnce();
    } finally {
      timeout.mockRestore();
    }
  });

  test('a timeout is "unreachable" too', async () => {
    const { fetch } = stubFetch(new DOMException('timed out', 'TimeoutError'));
    await expect(postToAuthorizationServer(TOKEN_ENDPOINT, {}, CREDENTIALS, fetch)).rejects.toThrow('unreachable: timed out');
  });

  test.each([
    ['an HTML page', new Response('<html>Bad gateway</html>', { status: 502 })],
    ['a JSON array', Response.json([1])],
    ['JSON null', Response.json(null)],
  ])('%s is not an answer', async (_, response) => {
    const { fetch } = stubFetch(response);
    await expect(postToAuthorizationServer(TOKEN_ENDPOINT, {}, CREDENTIALS, fetch))
      .rejects.toBeInstanceOf(AuthorizationServerUnavailableError);
  });
});

describe('postToAuthorizationServer: redirects, Retry-After and the shared pause', () => {
  test('redirects are refused, so a token is never sent anywhere else', async () => {
    const fetchStub = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe('error');
      return Response.json({ active: false });
    }) as unknown as typeof fetch;
    await postToAuthorizationServer(TOKEN_ENDPOINT, {}, CREDENTIALS, fetchStub);
    expect(fetchStub).toHaveBeenCalledOnce();
  });

  test.each([['1e308', 300], ['0', 1], ['42', 42]])('Retry-After %s is clamped to %i s', async (header, seconds) => {
    const { fetch } = stubFetch(oauthError(400, 'invalid_request', { 'Retry-After': header }));
    await expect(postToAuthorizationServer(TOKEN_ENDPOINT, {}, CREDENTIALS, fetch)).resolves.toMatchObject({ retryAfterSeconds: seconds });
  });

  test.each([
    ['429 with Retry-After', oauthError(429, 'too_many_requests', { 'Retry-After': '30' }), 30],
    ['503 without Retry-After', oauthError(503, 'temporarily_unavailable'), 5],
    ['an HTML 502', new Response('<html>Bad gateway</html>', { status: 502 }), 5],
    ['no answer', Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }), 5],
  ])('%s pauses every call for its delay, without a request', async (_, answer, seconds) => {
    const clock = { now: 1_000_000 };
    const backoff = new Backoff(() => clock.now);
    const { fetch, calls } = stubFetch(answer, Response.json({ active: false }));
    await postToAuthorizationServer(TOKEN_ENDPOINT, {}, CREDENTIALS, fetch, backoff).catch(() => {});
    const err = await postToAuthorizationServer(TOKEN_ENDPOINT, {}, CREDENTIALS, fetch, backoff).catch((e) => e);
    expect(err).toBeInstanceOf(AuthorizationServerUnavailableError);
    expect(err.retryAfterSeconds).toBe(seconds);
    expect(calls).toHaveLength(1);
    clock.now += seconds * 1000;
    await expect(postToAuthorizationServer(TOKEN_ENDPOINT, {}, CREDENTIALS, fetch, backoff)).resolves.toMatchObject({ status: 200 });
  });

  test('a refused redirect is named as such, and an unusable Retry-After pauses 5 s', async () => {
    const { fetch } = stubFetch(Object.assign(new TypeError('fetch failed'), { cause: new Error('unexpected redirect') }));
    await expect(postToAuthorizationServer(TOKEN_ENDPOINT, {}, CREDENTIALS, fetch)).rejects.toThrow('unreachable: unexpected redirect');
    const backoff = new Backoff();
    expect(backoff.pause('test', NaN)).toBe(5);
    expect(backoff.active).toBe(true);
  });

  test.each([[400, 'invalid_request'], [401, 'invalid_client']])('%i %s pauses nothing', async (status, error) => {
    const backoff = new Backoff();
    const { fetch, calls } = stubFetch(oauthError(status, error));
    await postToAuthorizationServer(TOKEN_ENDPOINT, {}, CREDENTIALS, fetch, backoff);
    await postToAuthorizationServer(TOKEN_ENDPOINT, {}, CREDENTIALS, fetch, backoff);
    expect([backoff.active, calls.length]).toEqual([false, 2]);
  });
});

describe('untilAborted', () => {
  test('passes the promise through without a signal, and rejects at once on an aborted one', async () => {
    await expect(untilAborted(Promise.resolve(1))).resolves.toBe(1);
    await expect(untilAborted(Promise.resolve(1), AbortSignal.abort(new Error('gone')))).rejects.toThrow('gone');
  });
});

describe('LruCache', () => {
  test('a hit refreshes the entry, an expired entry is gone', () => {
    const clock = { now: 0 };
    const cache = new LruCache<string>(2, () => clock.now);
    cache.set('a', 'A', 1000);
    cache.set('b', 'B', 1000);
    expect(cache.get('a')).toBe('A'); // a is now the most recently used
    cache.set('c', 'C', 1000); // evicts b
    expect([...cache.keys()]).toEqual(['a', 'c']);
    clock.now = 1000;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(1);
  });
});

// ── CarboneClient: one retry with a freshly exchanged key (spec test 5) ────────

describe('CarboneClient retry after a 401 (OAuth mode)', () => {
  afterEach(() => vi.restoreAllMocks());

  const unauthorized = () => Response.json({ success: false, error: 'Invalid token' }, { status: 401 });
  const tags = () => Response.json({ success: true, data: [{ name: 'a' }] });

  function carboneApi(...responses: Array<() => Response>) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (responses.length > 1 ? responses.shift()! : responses[0])());
  }
  const authOf = (spy: ReturnType<typeof carboneApi>, i: number) => new Headers(spy.mock.calls[i][1]!.headers).get('authorization');

  test('a 401 once: one new key, and the retry succeeds with it', async () => {
    const api = carboneApi(unauthorized, tags);
    const refreshKey = vi.fn(async () => 'jwt-2');
    const signal = new AbortController().signal;
    const client = new CarboneClient({ transport: 'http', requireClientAuth: true });
    await expect(client.getTags({ apiKey: 'jwt-1', refreshKey, signal })).resolves.toEqual(['a']);
    expect(refreshKey).toHaveBeenCalledTimes(1);
    expect(refreshKey).toHaveBeenCalledWith(signal);
    expect([authOf(api, 0), authOf(api, 1)]).toEqual(['Bearer jwt-1', 'Bearer jwt-2']);
  });

  test('a 401 twice: CarboneAuthError asking to sign in again (never for an API key), and no third exchange', async () => {
    const api = carboneApi(unauthorized);
    const refreshKey = vi.fn(async () => 'jwt-2');
    const client = new CarboneClient({ transport: 'http', requireClientAuth: true });
    const err = await client.getTags({ apiKey: 'jwt-1', refreshKey }).catch((e) => e);
    expect(err).toBeInstanceOf(CarboneAuthError);
    expect(err.message).toContain('Sign in again from your MCP client');
    expect(err.message).not.toMatch(/API key/);
    expect(refreshKey).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledTimes(2);
  });

  test('without refreshKey (API keys, stdio) a 401 is not retried', async () => {
    const api = carboneApi(unauthorized, tags);
    await expect(new CarboneClient({ apiKey: 'k' }).getTags()).rejects.toBeInstanceOf(CarboneAuthError);
    expect(api).toHaveBeenCalledTimes(1);
  });

  test('a failed re-exchange is the error of the call', async () => {
    carboneApi(unauthorized);
    const refreshKey = vi.fn(async () => { throw new CarboneAuthError('sign in again'); });
    const client = new CarboneClient({ transport: 'http', requireClientAuth: true });
    await expect(client.getTags({ apiKey: 'jwt-1', refreshKey })).rejects.toThrow('sign in again');
  });
});

describe('callOptionsFrom', () => {
  const signal = new AbortController().signal;

  test('forwards the Bearer key and the signal; refreshKey only when the request carries one', () => {
    expect(callOptionsFrom({ mcpReq: { signal } })).toEqual({ apiKey: undefined, signal });
    expect(callOptionsFrom({ http: { authInfo: { token: 'key' } }, mcpReq: { signal } })).toEqual({ apiKey: 'key', signal });
    const refreshKey = async () => 'jwt-2';
    expect(callOptionsFrom({ http: { authInfo: { token: 'jwt-1', extra: { refreshKey } } }, mcpReq: { signal } }))
      .toEqual({ apiKey: 'jwt-1', signal, refreshKey });
  });
});
