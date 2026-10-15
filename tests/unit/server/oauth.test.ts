import { describe, test, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { buildOAuthProtectedResourceMetadata, OAuthError, type AuthInfo } from '@modelcontextprotocol/server';
import {
  IntrospectionVerifier,
  TooManyFailedAttemptsError,
  addressKey,
  createOAuthGate,
  isCarboneApiKey,
  protectedResourceMetadata,
} from '../../../src/server/oauth.js';
import { AuthorizationServerUnavailableError } from '../../../src/carbone/tokenExchange.js';
import { CarboneAuthError, CarboneConnectionError } from '../../../src/carbone/errors.js';
import { tokenCacheKey } from '../../../src/utils/lru.js';

/** OAuth resource-server pieces, against a stubbed authorization server (fetch stub, never the network). */

const ISSUER = 'https://account.example.test';
const RESOURCE = 'https://mcp.example.test';
const CONFIG = { issuer: ISSUER, clientId: 'mcp-server', clientSecret: 'server-secret', resourceUrl: RESOURCE };
// The real clock (whole seconds): the SDK checks expiry against Date.now(), so a fixed date would expire one day.
const NOW_MS = Math.floor(Date.now() / 1000) * 1000;
const NOW_S = NOW_MS / 1000;

const b64url = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
/** A JWT-shaped string; the signature bytes are irrelevant (nothing verifies it here). */
const jwt = (payload: unknown, header: unknown = { alg: 'ES512', typ: 'JWT' }) =>
  `${b64url(header)}.${b64url(payload)}.${randomBytes(132).toString('base64url')}`;
/** Shaped like a real Carbone API key: ES512, aud "carbone", numeric-string iss. */
const apiKey = () => jwt({ iss: '123456789012', aud: 'carbone', exp: NOW_S + 3600, data: { type: 'test' } });

// ── (b) D1 discriminator ──────────────────────────────────────────────────────

describe('isCarboneApiKey: routing by token shape', () => {
  test('a real-shaped Carbone API key takes the API-key path, with or without the test_ prefix', () => {
    expect(isCarboneApiKey(apiKey())).toBe(true);
    expect(isCarboneApiKey(`test_${apiKey()}`)).toBe(true);
  });

  test.each([
    ['an opaque random token', randomBytes(32).toString('base64url')],
    ['an opaque token with dots', `${randomBytes(8).toString('hex')}.${randomBytes(8).toString('hex')}.${randomBytes(8).toString('hex')}`],
    ['a JWT for another audience', jwt({ iss: '1', aud: 'https://api.example.com' })],
    ['a JWT whose aud is an array', jwt({ iss: '1', aud: ['carbone'] })],
    ['a JWT without aud', jwt({ iss: '1' })],
    ['a header without alg', jwt({ aud: 'carbone' }, { typ: 'JWT' })],
    ['two segments', `${b64url({ alg: 'ES512' })}.${b64url({ aud: 'carbone' })}`],
    ['four segments', `${jwt({ aud: 'carbone' })}.extra`],
    ['an empty signature (unsecured JWS)', `${b64url({ alg: 'none' })}.${b64url({ aud: 'carbone' })}.`],
    ['invalid base64url', `${b64url({ alg: 'ES512' })}.${b64url({ aud: 'carbone' })}$.sig`],
    ['standard base64 characters', `${b64url({ alg: 'ES512' })}.${Buffer.from(JSON.stringify({ aud: 'carbone' })).toString('base64')}+/=.sig`],
    ['a header that is not JSON', `${b64url('not json')}.${b64url({ aud: 'carbone' })}.sig`],
    ['a payload that is not JSON', `${b64url({ alg: 'ES512' })}.${b64url('{aud:carbone')}.sig`],
    ['a payload that is a JSON array', `${b64url({ alg: 'ES512' })}.${b64url(['carbone'])}.sig`],
    ['a payload that is JSON null', `${b64url({ alg: 'ES512' })}.${b64url('null')}.sig`],
    ['an empty string', ''],
    ['the test_ prefix alone', 'test_'],
    ['a Carbone JWT minted through OAuth', jwt({ iss: '1', aud: 'carbone', data: { clientID: 'c', origin: 'oauth2', type: 'prod' } })],
    ['a test Carbone JWT minted through OAuth', `test_${jwt({ iss: '1', aud: 'carbone', data: { origin: 'oauth2', type: 'test' } })}`],
  ])('%s takes the OAuth path', (_, token) => {
    expect(isCarboneApiKey(token)).toBe(false);
  });

  test('random input never throws', () => {
    for (let i = 0; i < 200; i++) {
      const parts = Array.from({ length: 1 + (i % 4) }, () => randomBytes(i % 40).toString(i % 2 ? 'base64' : 'base64url'));
      expect(() => isCarboneApiKey(parts.join('.'))).not.toThrow();
    }
  });
});

// ── Spec test 1: Protected Resource Metadata ─────────────────────────────────

describe('protectedResourceMetadata', () => {
  test('origin-only resource: "resource" is the literal string, without the slash URL.href adds', () => {
    const doc = protectedResourceMetadata({ issuer: ISSUER, resourceUrl: 'https://mcp.example.test' });
    expect(doc).toEqual({
      resource: 'https://mcp.example.test',
      authorization_servers: [ISSUER],
      scopes_supported: ['doc_rwd'],
      bearer_methods_supported: ['header'],
    });
    // The drift this guards against: the SDK helper alone emits the href form.
    const sdk = buildOAuthProtectedResourceMetadata({
      resourceServerUrl: new URL('https://mcp.example.test'),
      oauthMetadata: { issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, response_types_supported: ['code'] },
    });
    expect(sdk.resource).toBe('https://mcp.example.test/');
  });

  test('resource with a path is kept as is', () => {
    expect(protectedResourceMetadata({ issuer: ISSUER, resourceUrl: 'https://mcp.example.test/mcp' }).resource).toBe('https://mcp.example.test/mcp');
  });

  test('the advertised metadata URL and served paths, origin-only and with a path', () => {
    const origin = createOAuthGate({ ...CONFIG, resourceUrl: 'https://mcp.example.test' });
    expect(origin.resourceMetadataUrl).toBe('https://mcp.example.test/.well-known/oauth-protected-resource');
    expect([...origin.metadataPaths]).toEqual(['/.well-known/oauth-protected-resource']);

    const withPath = createOAuthGate({ ...CONFIG, resourceUrl: 'https://mcp.example.test/mcp' });
    expect(withPath.resourceMetadataUrl).toBe('https://mcp.example.test/.well-known/oauth-protected-resource/mcp');
    expect([...withPath.metadataPaths]).toEqual(['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']);
    expect(JSON.parse(withPath.metadataJson).resource).toBe('https://mcp.example.test/mcp');
  });

  test('a non-https issuer is refused when the gate is built (startup)', () => {
    expect(() => createOAuthGate({ ...CONFIG, issuer: 'http://account.example.test' })).toThrow('Issuer URL must be HTTPS');
  });
});

// ── Authorization server stub ─────────────────────────────────────────────────

interface Introspected { active: boolean; scope?: string; client_id?: string; sub?: string; exp?: number; aud?: unknown }

/** Stub authorization server: introspection answers from `tokens`, the exchange from `exchange`. */
function authorizationServer(options: {
  tokens?: Record<string, Introspected>;
  /** Answers instead of `tokens` when it returns a Response. */
  introspection?: () => Response | undefined;
  exchange?: () => Response;
} = {}) {
  const requests: { endpoint: string; form: URLSearchParams; authorization: string | null }[] = [];
  let exchanges = 0;
  const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const endpoint = new URL(String(url)).pathname;
    const form = new URLSearchParams(String(init?.body));
    requests.push({ endpoint, form, authorization: new Headers(init?.headers).get('authorization') });
    if (endpoint === '/api/oauth/introspect') {
      return options.introspection?.() ?? Response.json(options.tokens?.[form.get('token')!] ?? { active: false });
    }
    exchanges++;
    return options.exchange?.() ?? Response.json({ access_token: `exchanged-jwt-${exchanges}`, token_type: 'Bearer', expires_in: 900 });
  });
  const count = (endpoint: string) => requests.filter((r) => r.endpoint === endpoint).length;
  return {
    fetch: fetchStub as unknown as typeof fetch,
    requests,
    introspections: () => count('/api/oauth/introspect'),
    exchanges: () => count('/api/oauth/token'),
  };
}

const active = (overrides: Partial<Introspected> = {}): Introspected => ({
  active: true, scope: 'doc_rwd', client_id: 'example-client', sub: '42', exp: NOW_S + 3600, aud: RESOURCE, ...overrides,
});

// ── IntrospectionVerifier ─────────────────────────────────────────────────────

describe('IntrospectionVerifier', () => {
  const newVerifier = (as: ReturnType<typeof authorizationServer>, clock = { now: NOW_MS }, maxEntries?: number) =>
    new IntrospectionVerifier({
      introspectionEndpoint: `${ISSUER}/api/oauth/introspect`,
      credentials: { clientId: 'mcp-server', clientSecret: 'server-secret' },
      fetch: as.fetch,
      now: () => clock.now,
      maxEntries,
    });

  test('posts the token with client_secret_basic and maps the answer to AuthInfo', async () => {
    const as = authorizationServer({ tokens: { opaque: active() } });
    const info = await newVerifier(as).verifyAccessToken('opaque');
    expect(info).toEqual({
      token: 'opaque', clientId: 'example-client', scopes: ['doc_rwd'], expiresAt: NOW_S + 3600,
      resource: new URL(RESOURCE), extra: { sub: '42' },
    });
    expect(Object.fromEntries(as.requests[0].form)).toEqual({ token: 'opaque' });
    expect(as.requests[0].authorization).toBe(`Basic ${Buffer.from('mcp-server:server-secret').toString('base64')}`);
  });

  test('a single-valued aud array is accepted; anything else leaves the resource unset', async () => {
    const as = authorizationServer({ tokens: {
      one: active({ aud: [RESOURCE] }), two: active({ aud: [RESOURCE, 'https://other.example'] }), bad: active({ aud: 'not a url' }),
    } });
    const verifier = newVerifier(as);
    expect((await verifier.verifyAccessToken('one')).resource?.href).toBe(`${RESOURCE}/`);
    expect((await verifier.verifyAccessToken('two')).resource).toBeUndefined();
    expect((await verifier.verifyAccessToken('bad')).resource).toBeUndefined();
  });

  test('an answer without client_id or scope gives an empty client id and no scopes', async () => {
    const as = authorizationServer({ tokens: { bare: active({ client_id: undefined, scope: undefined }) } });
    const info = await newVerifier(as).verifyAccessToken('bare');
    expect([info.clientId, info.scopes]).toEqual(['', []]);
  });

  test('active verdicts are cached for 60 s at most', async () => {
    const clock = { now: NOW_MS };
    const as = authorizationServer({ tokens: { opaque: active() } });
    const verifier = newVerifier(as, clock);
    await verifier.verifyAccessToken('opaque');
    clock.now += 59_000;
    await verifier.verifyAccessToken('opaque');
    expect(as.introspections()).toBe(1);
    clock.now += 1_000;
    await verifier.verifyAccessToken('opaque');
    expect(as.introspections()).toBe(2);
  });

  test('…past its expiry a token is refused without a request; an active one without exp is refused like an inactive one', async () => {
    const clock = { now: NOW_MS };
    const as = authorizationServer({ tokens: { soon: active({ exp: NOW_S + 20 }), noexp: active({ exp: undefined }) } });
    const verifier = newVerifier(as, clock);
    await verifier.verifyAccessToken('soon');
    clock.now += 20_000;
    const err = await verifier.verifyAccessToken('soon').catch((e) => e);
    expect([err.constructor, err.code, err.message]).toEqual([OAuthError, 'invalid_token', 'The access token has expired']);
    expect(as.introspections()).toBe(1);
    await expect(verifier.verifyAccessToken('noexp')).rejects.toThrow('The access token is not active');
    await expect(verifier.verifyAccessToken('noexp')).rejects.toThrow('The access token is not active');
    expect(as.introspections()).toBe(2);
  });

  test('inactive verdicts are refused with invalid_token and cached 10 s', async () => {
    const clock = { now: NOW_MS };
    const as = authorizationServer();
    const verifier = newVerifier(as, clock);
    const err = await verifier.verifyAccessToken('unknown').catch((e) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect(err.code).toBe('invalid_token');
    clock.now += 9_000;
    await expect(verifier.verifyAccessToken('unknown')).rejects.toBeInstanceOf(OAuthError);
    expect(as.introspections()).toBe(1);
    clock.now += 1_000;
    await expect(verifier.verifyAccessToken('unknown')).rejects.toBeInstanceOf(OAuthError);
    expect(as.introspections()).toBe(2);
  });

  test('concurrent checks of one token share one introspection', async () => {
    const as = authorizationServer({ tokens: { opaque: active() } });
    const verifier = newVerifier(as);
    await Promise.all([1, 2, 3].map(() => verifier.verifyAccessToken('opaque')));
    expect(as.introspections()).toBe(1);
  });

  test.each([
    ['5xx', () => Response.json({ error: 'server_error' }, { status: 502 })],
    ['401 invalid_client', () => Response.json({ error: 'invalid_client' }, { status: 401 })],
    ['429', () => Response.json({ error: 'too_many_requests' }, { status: 429, headers: { 'Retry-After': '30' } })],
  ])('introspection %s is "unavailable" (503), never invalid_token (401), and not cached', async (_, introspection) => {
    const as = authorizationServer({ introspection });
    const verifier = newVerifier(as);
    const err = await verifier.verifyAccessToken('opaque').catch((e) => e);
    expect(err).toBeInstanceOf(AuthorizationServerUnavailableError);
    expect(err).not.toBeInstanceOf(OAuthError);
    expect(verifier.cacheSize).toBe(0);
  });

  // (d) the verdict cache is bounded, and keyed by SHA-256
  test('many distinct tokens keep the verdict cache at its bound, keyed by SHA-256, never the raw token', async () => {
    const as = authorizationServer();
    const verifier = newVerifier(as, undefined, 50);
    const tokens = Array.from({ length: 500 }, () => randomBytes(16).toString('hex'));
    for (const token of tokens) await verifier.verifyAccessToken(token).catch(() => {});
    expect(verifier.cacheSize).toBe(50);
    const keys = verifier.cacheKeys();
    expect(keys).toEqual(tokens.slice(-50).map(tokenCacheKey));
    expect(keys.some((key) => tokens.includes(key))).toBe(false);
  });
});

// ── Flood protection: the authorization server throttled or down, fake tokens, failure budget ─────

describe('IntrospectionVerifier under load', () => {
  const ADDRESS = '203.0.113.7';
  const newVerifier = (as: ReturnType<typeof authorizationServer>, clock: { now: number }, maxEntries?: number) =>
    new IntrospectionVerifier({
      introspectionEndpoint: `${ISSUER}/api/oauth/introspect`,
      credentials: { clientId: 'mcp-server', clientSecret: 'server-secret' },
      fetch: as.fetch,
      now: () => clock.now,
      maxEntries,
    });
  /** The stub answers from `tokens` until `state.failWith` is set. */
  function flakyServer(tokens: Record<string, Introspected>) {
    const state: { failWith?: () => Response } = {};
    return { as: authorizationServer({ tokens, introspection: () => state.failWith?.() }), state };
  }
  const unavailable = (status: number, retryAfter?: string) => () =>
    Response.json({ error: 'temporarily_unavailable' }, { status, headers: retryAfter ? { 'Retry-After': retryAfter } : {} });

  test('a signed-in user keeps working for 10 min after the last check while the authorization server is down', async () => {
    const clock = { now: NOW_MS };
    const { as, state } = flakyServer({ opaque: active() });
    const verifier = newVerifier(as, clock);
    await verifier.verifyAccessToken('opaque');
    state.failWith = unavailable(503);
    clock.now += 61_000; // due for a check, which fails: the last verdict is used
    await expect(verifier.verifyAccessToken('opaque')).resolves.toMatchObject({ token: 'opaque', scopes: ['doc_rwd'] });
    clock.now += 537_000; // 598 s after the last check
    await expect(verifier.verifyAccessToken('opaque')).resolves.toMatchObject({ token: 'opaque' });
    clock.now += 3_000; // 601 s
    await expect(verifier.verifyAccessToken('opaque')).rejects.toBeInstanceOf(AuthorizationServerUnavailableError);
    // A user never seen gets 503 at once: there is no verdict to fall back on
    await expect(verifier.verifyAccessToken('someone-else')).rejects.toBeInstanceOf(AuthorizationServerUnavailableError);
  });

  test('…never past the token expiry, and a revocation counts as soon as the authorization server answers', async () => {
    const clock = { now: NOW_MS };
    const tokens: Record<string, Introspected> = { short: active({ exp: NOW_S + 90 }), revoked: active() };
    const { as, state } = flakyServer(tokens);
    const verifier = newVerifier(as, clock);
    await verifier.verifyAccessToken('short');
    await verifier.verifyAccessToken('revoked');
    state.failWith = unavailable(503);
    clock.now += 91_000;
    await expect(verifier.verifyAccessToken('short')).rejects.toThrow('The access token has expired');
    delete tokens['revoked'];
    state.failWith = undefined;
    await expect(verifier.verifyAccessToken('revoked')).rejects.toThrow('The access token is not active');
  });

  test('after a 429, unseen tokens wait its Retry-After without a request; signed-in users are served', async () => {
    const clock = { now: NOW_MS };
    const { as, state } = flakyServer({ opaque: active(), newcomer: active() });
    const verifier = newVerifier(as, clock);
    await verifier.verifyAccessToken('opaque');
    clock.now += 61_000;
    state.failWith = unavailable(429, '30');
    await expect(verifier.verifyAccessToken('unseen')).rejects.toMatchObject({ retryAfterSeconds: 30 });
    state.failWith = undefined; // it would answer again, but asked for 30 s
    const requests = as.introspections();
    await expect(verifier.verifyAccessToken('opaque')).resolves.toMatchObject({ token: 'opaque' });
    const err = await verifier.verifyAccessToken('newcomer').catch((e) => e);
    expect(err).toBeInstanceOf(AuthorizationServerUnavailableError);
    expect(err.retryAfterSeconds).toBe(30);
    expect(as.introspections()).toBe(requests);
    clock.now += 30_000;
    await expect(verifier.verifyAccessToken('newcomer')).resolves.toMatchObject({ token: 'newcomer' });
  });

  test('a known token failing its check pauses every call (5 s without Retry-After); an unseen token only fails its own request', async () => {
    const clock = { now: NOW_MS };
    const { as, state } = flakyServer({ opaque: active(), newcomer: active(), another: active() });
    const verifier = newVerifier(as, clock);
    await verifier.verifyAccessToken('opaque');
    // A token an attacker picks to make the server fail only fails that request: the next one is still checked
    state.failWith = unavailable(502);
    await expect(verifier.verifyAccessToken('unseen')).rejects.toMatchObject({ retryAfterSeconds: 5 });
    state.failWith = undefined;
    await expect(verifier.verifyAccessToken('newcomer')).resolves.toMatchObject({ token: 'newcomer' });
    // A known token failing its check is an outage: its last verdict is served, every call waits 5 s
    clock.now += 61_000;
    state.failWith = unavailable(502);
    await expect(verifier.verifyAccessToken('opaque')).resolves.toMatchObject({ token: 'opaque' });
    state.failWith = undefined;
    const requests = as.introspections();
    await expect(verifier.verifyAccessToken('another')).rejects.toBeInstanceOf(AuthorizationServerUnavailableError);
    expect(as.introspections()).toBe(requests);
    clock.now += 5_000;
    await expect(verifier.verifyAccessToken('another')).resolves.toMatchObject({ token: 'another' });
  });

  test('a 401 invalid_client is no outage: no pause, and no last verdict', async () => {
    const clock = { now: NOW_MS };
    const { as, state } = flakyServer({ opaque: active() });
    const verifier = newVerifier(as, clock);
    await verifier.verifyAccessToken('opaque');
    clock.now += 61_000;
    state.failWith = () => Response.json({ error: 'invalid_client' }, { status: 401 });
    await expect(verifier.verifyAccessToken('opaque')).rejects.toBeInstanceOf(AuthorizationServerUnavailableError);
    await expect(verifier.verifyAccessToken('opaque')).rejects.toBeInstanceOf(AuthorizationServerUnavailableError);
    expect(as.introspections()).toBe(3);
  });

  test('a Retry-After is clamped to 300 s', async () => {
    const clock = { now: NOW_MS };
    const { as, state } = flakyServer({});
    const verifier = newVerifier(as, clock);
    state.failWith = unavailable(429, '1e308');
    await expect(verifier.verifyAccessToken('unseen')).rejects.toMatchObject({ retryAfterSeconds: 300 });
    state.failWith = undefined;
    clock.now += 300_000;
    await expect(verifier.verifyAccessToken('unseen')).rejects.toBeInstanceOf(OAuthError);
  });

  test('fake tokens cannot evict the verdicts of signed-in users', async () => {
    const clock = { now: NOW_MS };
    const { as } = flakyServer({ opaque: active() });
    const verifier = newVerifier(as, clock, 5);
    await verifier.verifyAccessToken('opaque');
    for (let i = 0; i < 50; i++) await verifier.verifyAccessToken(`fake-${i}`).catch(() => {});
    const requests = as.introspections();
    await verifier.verifyAccessToken('opaque');
    expect(as.introspections()).toBe(requests);
  });

  /** Introspections of unseen tokens from many addresses (10 each, below their own budget). */
  const pressure = async (verifier: IntrospectionVerifier, count: number) => {
    for (let i = 0; i < count; i++) await verifier.verify(`pressure-${i}`, `198.51.100.${i % Math.ceil(count / 10)}`).catch(() => {});
  };

  test('nobody is limited without pressure; past half the all-clients budget, an address may fail 60 times a minute, then 429', async () => {
    const clock = { now: NOW_MS };
    const { as } = flakyServer({});
    const verifier = newVerifier(as, clock);
    for (let i = 0; i < 100; i++) await expect(verifier.verify(`fake-${i}`, ADDRESS)).rejects.toBeInstanceOf(OAuthError);
    await pressure(verifier, 400);
    const err = await verifier.verify('fake-100', ADDRESS).catch((e) => e);
    expect(err).toBeInstanceOf(TooManyFailedAttemptsError);
    expect(err.retryAfterSeconds).toBe(60);
    expect(as.introspections()).toBe(500);
    // A token refused a moment ago is refused again for free; another address has its own budget
    await expect(verifier.verify('fake-0', ADDRESS)).rejects.toBeInstanceOf(OAuthError);
    await expect(verifier.verify('other', '192.0.2.200')).rejects.toBeInstanceOf(OAuthError);
    clock.now += 60_000;
    await expect(verifier.verify('fake-101', ADDRESS)).rejects.toBeInstanceOf(OAuthError);
  });

  test('beyond 1000 unseen tokens a minute from all clients, the next ones get 503 without a request; known users are still checked', async () => {
    const clock = { now: NOW_MS };
    const { as } = flakyServer({ known: active() });
    const verifier = newVerifier(as, clock);
    await verifier.verify('known');
    clock.now += 30_000;
    for (let i = 0; i < 1000; i++) await verifier.verify(`fake-${i}`, `198.51.100.${i % 200}`).catch(() => {});
    const err = await verifier.verify('one-more', '192.0.2.1').catch((e) => e);
    expect(err).toBeInstanceOf(AuthorizationServerUnavailableError);
    expect(err.retryAfterSeconds).toBe(60);
    expect(as.introspections()).toBe(1001);
    clock.now += 31_000; // "known" is due for a check, the window not over yet
    await expect(verifier.verify('known', '192.0.2.1')).resolves.toMatchObject({ token: 'known' });
    expect(as.introspections()).toBe(1002);
  });

  test('valid tokens and an unreachable authorization server cost an address nothing; signed-in users are never limited', async () => {
    const clock = { now: NOW_MS };
    const tokens: Record<string, Introspected> = { known: active() };
    for (let i = 0; i < 100; i++) tokens[`user-${i}`] = active();
    const { as, state } = flakyServer(tokens);
    const verifier = newVerifier(as, clock);
    await verifier.verify('known');
    clock.now += 10_000;
    for (let i = 0; i < 100; i++) await verifier.verify(`user-${i}`, ADDRESS);
    state.failWith = unavailable(502);
    for (let i = 0; i < 10; i++) await expect(verifier.verify(`down-${i}`, ADDRESS)).rejects.toBeInstanceOf(AuthorizationServerUnavailableError);
    state.failWith = undefined;
    clock.now += 5_000;
    await pressure(verifier, 400);
    for (let i = 0; i < 60; i++) await expect(verifier.verify(`fake-${i}`, ADDRESS)).rejects.toBeInstanceOf(OAuthError);
    await expect(verifier.verify('fake-60', ADDRESS)).rejects.toBeInstanceOf(TooManyFailedAttemptsError);
    clock.now += 46_000; // "known" is due for a check: it is no stranger, so it is checked whatever the budget
    await expect(verifier.verify('known', ADDRESS)).resolves.toMatchObject({ token: 'known' });
    await expect(verifier.verify('fake-61', ADDRESS)).rejects.toBeInstanceOf(TooManyFailedAttemptsError);
  });

  test('the log names one limited address every 10 s at most and counts the others', async () => {
    const clock = { now: NOW_MS };
    const { as } = flakyServer({});
    const verifier = newVerifier(as, clock);
    const exhaust = async (address: string) => {
      for (let i = 0; i <= 60; i++) await verifier.verify(`${address}-fake-${i}`, address).catch(() => {});
    };
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await pressure(verifier, 500);
      for (const address of ['192.0.2.1', '192.0.2.2', '192.0.2.3']) await exhaust(address);
      clock.now += 10_000;
      await exhaust('192.0.2.4');
      expect(stderr.mock.calls.map(([chunk]) => String(chunk))).toEqual([
        '[carbone-mcp] OAuth: 192.0.2.1 sent too many tokens that are not valid: its unseen tokens get 429 for 60 s\n',
        '[carbone-mcp] OAuth: 192.0.2.4 sent too many tokens that are not valid: its unseen tokens get 429 for 60 s (and 2 more address(es) since the last report)\n',
      ]);
    } finally {
      stderr.mockRestore();
    }
  });

  test('concurrent requests with one unseen token make one introspection and are charged once', async () => {
    const { as } = flakyServer({});
    const verifier = newVerifier(as, { now: NOW_MS });
    await Promise.allSettled(Array.from({ length: 1000 }, (_, i) => verifier.verify('same', `198.51.100.${i % 200}`)));
    expect(as.introspections()).toBe(1);
    // The all-clients budget is not spent: the next token is still checked (401), not refused (503)
    await expect(verifier.verify('other', '192.0.2.9')).rejects.toBeInstanceOf(OAuthError);
  });

  test('concurrent attempts cannot overspend the budget', async () => {
    const { as } = flakyServer({});
    const verifier = newVerifier(as, { now: NOW_MS });
    await pressure(verifier, 500);
    const results = await Promise.allSettled(Array.from({ length: 100 }, (_, i) => verifier.verify(`fake-${i}`, ADDRESS)));
    expect(results.filter((r) => r.status === 'rejected' && r.reason instanceof TooManyFailedAttemptsError)).toHaveLength(40);
    expect(as.introspections()).toBe(560);
  });

  test('addressKey: IPv4 as is (also IPv4-mapped), IPv6 by its /64, bounded', () => {
    expect(addressKey('203.0.113.7')).toBe('203.0.113.7');
    expect(addressKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(addressKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:db8:1:2:bbbb:cccc:dddd:eeee')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(addressKey('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8:0:0::/64');
    expect(addressKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(addressKey('::1')).toBe('0:0:0:0::/64');
    expect(addressKey('x'.repeat(500))).toHaveLength(64);
  });
});

// ── The gate: spec tests 2, 3, 4 and 7 without HTTP ───────────────────────────

describe('createOAuthGate().authenticate', () => {
  const gateWith = (as: ReturnType<typeof authorizationServer>) => createOAuthGate(CONFIG, { fetch: as.fetch, now: () => NOW_MS });

  async function expectChallenge(result: AuthInfo | Response, status = 401, error = 'invalid_token') {
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(status);
    const challenge = response.headers.get('www-authenticate')!;
    expect(challenge).toMatch(new RegExp(`^Bearer error="${error}"`));
    expect(challenge).toContain(`resource_metadata="${RESOURCE}/.well-known/oauth-protected-resource"`);
    expect(challenge).toContain('scope="doc_rwd"');
    expect((await response.json()).error).toBe(error);
  }

  /** No credentials: the challenge without an error code (RFC 6750 §3.1), and no body. */
  async function expectBareChallenge(result: AuthInfo | Response) {
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate'))
      .toBe(`Bearer scope="doc_rwd", resource_metadata="${RESOURCE}/.well-known/oauth-protected-resource"`);
    expect(await response.text()).toBe('');
  }

  test.each([
    ['no Authorization header', undefined],
    ['an empty one', ''],
    ['another scheme', 'Basic bWU6cHc='],
    ['a scheme that only starts like Bearer', 'Bearerabc'],
    ['a Bearer without a token', 'Bearer'],
    ['a Bearer with only spaces', 'Bearer   '],
  ])('no credentials (%s): the bare 401 challenge, without an error code (RFC 6750 §3.1)', async (_label, header) => {
    const as = authorizationServer();
    await expectBareChallenge(await gateWith(as).authenticate(header));
    expect(as.requests).toHaveLength(0);
  });

  test.each([
    ['two tokens', 'Bearer abc def'],
    ['a comma', 'Bearer abc,def'],
    ['a quote', 'Bearer abc"def'],
    ['padding inside the token', 'Bearer ab=c'],
  ])('a malformed Bearer (%s): 400 invalid_request, never introspected', async (_label, header) => {
    const as = authorizationServer();
    await expectChallenge(await gateWith(as).authenticate(header), 400, 'invalid_request');
    expect(as.requests).toHaveLength(0);
  });

  test('an address past its budget gets 429 with Retry-After and no challenge; requests without a token never count', async () => {
    const as = authorizationServer();
    const gate = gateWith(as);
    const address = '203.0.113.7';
    for (let i = 0; i < 100; i++) await expectBareChallenge(await gate.authenticate(undefined, undefined, address));
    for (let i = 0; i < 100; i++) await expectChallenge(await gate.authenticate('Bearer a b', undefined, address), 400, 'invalid_request');
    // Under pressure: past half the all-clients budget, from other addresses
    for (let i = 0; i < 500; i++) await gate.authenticate(`Bearer pressure${i}`, undefined, `198.51.100.${i % 50}`);
    for (let i = 0; i < 60; i++) await expectChallenge(await gate.authenticate(`Bearer fake${i}`, undefined, address));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const res = await gate.authenticate('Bearer fake60', undefined, address) as Response;
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('60');
      expect(res.headers.get('www-authenticate')).toBeNull();
      expect((await res.json()).error).toBe('too_many_requests');
      expect(as.introspections()).toBe(560);
      await gate.authenticate('Bearer fake61', undefined, address);
      // Logged once per window, with the address and never a token
      const lines = stderr.mock.calls.map(([chunk]) => String(chunk));
      expect(lines).toEqual([
        '[carbone-mcp] OAuth: 203.0.113.7 sent too many tokens that are not valid: its unseen tokens get 429 for 60 s\n',
      ]);
    } finally {
      stderr.mockRestore();
    }
  });

  test('the scheme is case-insensitive and may be followed by several spaces (RFC 6750 §2.1)', async () => {
    const as = authorizationServer({ tokens: { opaque: active() } });
    expect((await gateWith(as).authenticate('bearer   opaque') as AuthInfo).token).toMatch(/^exchanged-jwt-/);
  });

  test('an inactive token, and a token bound to another resource: 401, and no exchange', async () => {
    const as = authorizationServer({ tokens: { other: active({ aud: 'https://other.example.test' }) } });
    const gate = gateWith(as);
    await expectChallenge(await gate.authenticate('Bearer unknown'));
    await expectChallenge(await gate.authenticate('Bearer other'));
    expect(as.exchanges()).toBe(0);
  });

  test('an expired token (per introspection exp): 401 invalid_token', async () => {
    // The SDK checks expiry against the real clock
    const as = authorizationServer({ tokens: { old: active({ exp: Math.floor(Date.now() / 1000) - 1 }) } });
    await expectChallenge(await gateWith(as).authenticate('Bearer old'));
  });

  test('the audience in either spelling of an origin-only resource is this server (with or without the trailing slash URL.href adds)', async () => {
    const as = authorizationServer({ tokens: { canonical: active({ aud: `${RESOURCE}/` }), literal: active({ aud: RESOURCE }) } });
    const gate = gateWith(as);
    expect((await gate.authenticate('Bearer canonical') as AuthInfo).token).toMatch(/^exchanged-jwt-/);
    expect((await gate.authenticate('Bearer literal') as AuthInfo).token).toMatch(/^exchanged-jwt-/);
  });

  test('a token without doc_rwd: 403 insufficient_scope', async () => {
    const as = authorizationServer({ tokens: { narrow: active({ scope: 'profile' }) } });
    await expectChallenge(await gateWith(as).authenticate('Bearer narrow'), 403, 'insufficient_scope');
  });

  test('happy path: the request carries the exchanged JWT, never the opaque token', async () => {
    const as = authorizationServer({ tokens: { opaque: active() } });
    const auth = await gateWith(as).authenticate('Bearer opaque') as AuthInfo;
    expect(auth.token).toBe('exchanged-jwt-1');
    expect(JSON.stringify(auth)).not.toContain('opaque');
    expect(auth.clientId).toBe('example-client');
    expect(auth.extra).toMatchObject({ sub: '42', refreshKey: expect.any(Function) });
    const exchange = as.requests.find((r) => r.endpoint === '/api/oauth/token')!;
    expect(exchange.form.get('subject_token')).toBe('opaque');
  });

  test('spec test 4: within the TTLs a second request makes no introspection and no exchange', async () => {
    const as = authorizationServer({ tokens: { opaque: active() } });
    const gate = gateWith(as);
    await gate.authenticate('Bearer opaque');
    await gate.authenticate('Bearer opaque');
    expect([as.introspections(), as.exchanges()]).toEqual([1, 1]);
  });

  test('a token revoked between its introspection and its exchange: 401, then refused for 10 s without a request', async () => {
    const tokens: Record<string, Introspected> = { opaque: active() };
    const as = authorizationServer({
      tokens,
      exchange: () => { delete tokens['opaque']; return Response.json({ error: 'invalid_request' }, { status: 400 }); },
    });
    const gate = gateWith(as);
    await expectChallenge(await gate.authenticate('Bearer opaque'));
    expect([as.introspections(), as.exchanges()]).toEqual([2, 1]);
    await expectChallenge(await gate.authenticate('Bearer opaque'));
    expect([as.introspections(), as.exchanges()]).toEqual([2, 1]);
  });

  test('an exchange refused while the token is still active: 503 for that token only, a minute without a request, never a sign-in loop', async () => {
    const clock = { now: NOW_MS };
    const as = authorizationServer({
      tokens: { opaque: active(), other: active() },
      exchange: () => (as.exchanges() === 1 || as.exchanges() === 3
        ? Response.json({ error: 'invalid_request' }, { status: 400 })
        : Response.json({ access_token: `exchanged-jwt-${as.exchanges()}`, token_type: 'Bearer', expires_in: 900 })),
    });
    const gate = createOAuthGate(CONFIG, { fetch: as.fetch, now: () => clock.now });
    const err = await gate.authenticate('Bearer opaque').catch((e) => e);
    expect(err).toBeInstanceOf(AuthorizationServerUnavailableError);
    expect(err.retryAfterSeconds).toBe(60);
    // Nobody else is affected
    expect((await gate.authenticate('Bearer other') as AuthInfo).token).toBe('exchanged-jwt-2');
    // The same token again within the minute: 503 without a request
    const requests = as.requests.length;
    await expect(gate.authenticate('Bearer opaque')).rejects.toMatchObject({ retryAfterSeconds: 60 });
    expect(as.requests.length).toBe(requests);
    // A minute later it is asked again
    clock.now += 60_000;
    await expect(gate.authenticate('Bearer opaque')).rejects.toBeInstanceOf(AuthorizationServerUnavailableError);
    expect(as.exchanges()).toBe(3);
  });

  test('a Carbone JWT minted through OAuth is refused with 401, without a request; an API key never reaches the gate', async () => {
    const as = authorizationServer();
    const minted = jwt({ iss: '1', aud: 'carbone', exp: NOW_S + 3600, data: { clientID: 'another-client', origin: 'oauth2', type: 'prod' } });
    await expectChallenge(await gateWith(as).authenticate(`Bearer ${minted}`));
    await expectChallenge(await gateWith(as).authenticate(`Bearer test_${minted}`));
    expect(as.requests).toHaveLength(0);
    expect(isCarboneApiKey(apiKey())).toBe(true);
  });

  test.each([
    ['introspection', { introspection: () => new Response('down', { status: 503 }) }],
    ['token exchange', { tokens: { opaque: active() }, exchange: () => Response.json({ error: 'server_error' }, { status: 500 }) }],
  ])('%s 5xx: throws "unavailable" (answered 503), never a challenge', async (_, options) => {
    const as = authorizationServer(options);
    await expect(gateWith(as).authenticate('Bearer opaque')).rejects.toBeInstanceOf(AuthorizationServerUnavailableError);
  });

  test('refreshKey exchanges once more after the Carbone API refused the key, once for concurrent refusals', async () => {
    const as = authorizationServer({ tokens: { opaque: active() } });
    const auth = await gateWith(as).authenticate('Bearer opaque') as AuthInfo;
    expect(auth.token).toBe('exchanged-jwt-1');
    const refreshKey = auth.extra!['refreshKey'] as (signal?: AbortSignal) => Promise<string>;
    await expect(refreshKey()).resolves.toBe('exchanged-jwt-2');
    // Another call refused with the same stale key reuses the new one
    await expect(refreshKey()).resolves.toBe('exchanged-jwt-2');
    expect(as.exchanges()).toBe(2);
    expect(as.introspections()).toBe(1);
  });

  test('a revocation first seen while renewing the key gives the next request its 401 at once', async () => {
    const tokens: Record<string, Introspected> = { opaque: active() };
    const as = authorizationServer({
      tokens,
      exchange: () => (as.exchanges() === 1
        ? Response.json({ access_token: 'jwt-a', token_type: 'Bearer', expires_in: 900 })
        : (delete tokens['opaque'], Response.json({ error: 'invalid_request' }, { status: 400 }))),
    });
    const gate = gateWith(as);
    const auth = await gate.authenticate('Bearer opaque') as AuthInfo;
    await expect((auth.extra!['refreshKey'] as () => Promise<string>)()).rejects.toThrow('sign in again');
    await expectChallenge(await gate.authenticate('Bearer opaque'));
  });

  test('refreshKey renews a token once a minute at most: a renewed key refused again is the account itself', async () => {
    const clock = { now: NOW_MS };
    const as = authorizationServer({ tokens: { opaque: active() } });
    const gate = createOAuthGate(CONFIG, { fetch: as.fetch, now: () => clock.now });
    const first = await gate.authenticate('Bearer opaque') as AuthInfo;
    await expect((first.extra!['refreshKey'] as () => Promise<string>)()).resolves.toBe('exchanged-jwt-2');
    const renewed = await gate.authenticate('Bearer opaque') as AuthInfo;
    expect(renewed.token).toBe('exchanged-jwt-2');
    const refused = await (renewed.extra!['refreshKey'] as () => Promise<string>)().catch((e) => e);
    expect(refused).toBeInstanceOf(CarboneAuthError);
    expect(refused.message).toContain('Carbone refused the access granted by your sign-in');
    expect(as.exchanges()).toBe(2);
    clock.now += 60_000;
    await expect((renewed.extra!['refreshKey'] as () => Promise<string>)()).resolves.toBe('exchanged-jwt-3');
  });
});

describe('refreshKey error mapping', () => {
  /** A gate whose first exchange succeeds and whose later ones answer `later`. */
  async function refreshKeyThen(later: () => Response) {
    let first = true;
    const as = authorizationServer({
      tokens: { opaque: active() },
      exchange: () => (first ? ((first = false), Response.json({ access_token: 'jwt-a', expires_in: 900 })) : later()),
    });
    const auth = await createOAuthGate(CONFIG, { fetch: as.fetch, now: () => NOW_MS }).authenticate('Bearer opaque') as AuthInfo;
    return auth.extra!['refreshKey'] as (signal?: AbortSignal) => Promise<string>;
  }

  test('invalid_request → CarboneAuthError asking to sign in again', async () => {
    const refreshKey = await refreshKeyThen(() => Response.json({ error: 'invalid_request' }, { status: 400 }));
    const err = await refreshKey().catch((e) => e);
    expect(err).toBeInstanceOf(CarboneAuthError);
    expect(err.message).toContain('sign in again');
  });

  test('authorization server down → CarboneConnectionError', async () => {
    const refreshKey = await refreshKeyThen(() => new Response('down', { status: 503 }));
    await expect(refreshKey()).rejects.toBeInstanceOf(CarboneConnectionError);
  });

  test('a cancelled tool call stops waiting: the cancellation is rethrown as is', async () => {
    const refreshKey = await refreshKeyThen(() => Response.json({ access_token: 'jwt-b', expires_in: 900 }));
    await expect(refreshKey(AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled');
  });
});
