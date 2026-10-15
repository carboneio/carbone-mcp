import { parseRetryAfter } from './client.js';
import { LruCache, tokenCacheKey } from '../utils/lru.js';

/**
 * OAuth mode only: the MCP server is a confidential client of the authorization server (account.carbone.io).
 * It introspects the client's opaque token (RFC 7662, see src/server/oauth.ts) and exchanges it (RFC 8693) for a
 * short-lived Carbone API JWT. The client's own token is never sent to the Carbone API.
 */

export const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';
export const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

/** Every call to the authorization server gives up after this delay. */
const AUTHORIZATION_SERVER_TIMEOUT_MS = 10_000;
/** Retry-After sent to the MCP client when the authorization server gave none, and the pause after it failed. */
const DEFAULT_RETRY_AFTER_SECONDS = 5;
/** The longest pause accepted from a Retry-After: a far-off one would lock new sign-ins out until a restart. */
const MAX_RETRY_AFTER_SECONDS = 300;
/** The Carbone API refusing a JWT renews it at most once a minute per subject token. */
const RENEWAL_INTERVAL_MS = 60_000;
/** A subject token the exchange refused is refused again this long without asking. */
export const REFUSED_SUBJECT_SECONDS = 60;
/** How long an exchanged JWT is kept when the answer gives no `expires_in`. */
const DEFAULT_JWT_TTL_MS = 60_000;
/** An exchanged JWT is reused until this long before it expires. */
const EXPIRY_MARGIN_MS = 30_000;

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * The authorization server gave no usable answer: network error, timeout, 429, 5xx, or a refusal of this server's
 * own client credentials. The MCP request is answered 503 with Retry-After, never 401: a 401 makes the MCP client
 * sign in again, which fixes none of these.
 */
export class AuthorizationServerUnavailableError extends Error {
  constructor(message: string, readonly retryAfterSeconds = DEFAULT_RETRY_AFTER_SECONDS) {
    super(message);
    this.name = 'AuthorizationServerUnavailableError';
  }
}

/**
 * The token exchange refused the client's token (expired, revoked, unbound...): the client must sign in again.
 * `repeated`: refused again from memory, without asking the authorization server.
 */
export class SubjectTokenRejectedError extends Error {
  constructor(readonly oauthError: string, readonly repeated = false) {
    super('The access token was refused by the authorization server');
    this.name = 'SubjectTokenRejectedError';
  }
}

/** An operational log line, on stderr like the access log: printable ASCII only, and never a token. */
export function logOAuth(message: string): void {
  process.stderr.write(`[carbone-mcp] OAuth: ${message.replace(/[^\x20-\x7E]/g, '')}\n`);
}

/** A Retry-After within 1-300 s (5 s when unusable): a far-off one would lock new sign-ins out until a restart. */
function clampRetryAfter(seconds: number): number {
  return Number.isNaN(seconds) ? DEFAULT_RETRY_AFTER_SECONDS : Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(seconds)));
}

/**
 * Shared by every call to the authorization server: after a failure (see postToAuthorizationServer), it is left
 * alone for its Retry-After (clamped to 1-300 s; 5 s when it gave none), and calls fail at once with 503 meanwhile.
 */
export class Backoff {
  private until = 0;

  constructor(private readonly now: () => number = Date.now) {}

  get active(): boolean {
    return this.now() < this.until;
  }

  /** Throws AuthorizationServerUnavailableError while paused. */
  check(): void {
    const waitMs = this.until - this.now();
    if (waitMs > 0) throw new AuthorizationServerUnavailableError('Calls to the authorization server are paused after a failure', Math.ceil(waitMs / 1000));
  }

  /** Pause after a failure; returns the pause in seconds. */
  pause(reason: string, retryAfterSeconds = DEFAULT_RETRY_AFTER_SECONDS): number {
    const seconds = clampRetryAfter(retryAfterSeconds);
    const until = this.now() + seconds * 1000;
    if (!this.active) logOAuth(`${reason}: the authorization server is left alone for ${seconds} s`);
    this.until = Math.max(this.until, until);
    return seconds;
  }
}

/** RFC 6749 §2.3.1: client_secret_basic form-encodes the id and the secret before joining them. */
function basicAuthorization({ clientId, clientSecret }: OAuthClientCredentials): string {
  const formEncode = (value: string) => new URLSearchParams({ v: value }).toString().slice(2);
  return `Basic ${Buffer.from(`${formEncode(clientId)}:${formEncode(clientSecret)}`).toString('base64')}`;
}

/**
 * POST a form to the authorization server with client_secret_basic authentication and return its status and
 * JSON body. No answer, or a body that is not JSON, throws AuthorizationServerUnavailableError. Error messages
 * name the endpoint and the status only, never a token or the secret. With `backoff`, nothing is sent while it
 * is paused, and no answer or a 429 pauses it (a 5xx too, unless `pauseOnServerError` is false: a failure tied
 * to one token must not stop the others). Redirects are refused: a token is never sent anywhere else.
 */
export async function postToAuthorizationServer(
  url: string,
  form: Record<string, string>,
  credentials: OAuthClientCredentials,
  fetchImpl: typeof fetch = fetch,
  backoff?: Backoff,
  pauseOnServerError = true
): Promise<{ status: number; body: Record<string, unknown>; retryAfterSeconds?: number }> {
  const endpoint = new URL(url).pathname;
  backoff?.check();
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: basicAuthorization(credentials),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(AUTHORIZATION_SERVER_TIMEOUT_MS),
    });
  } catch (err) {
    // The system error code, or the error message (it never carries the request body or headers).
    const cause = (err as { cause?: { code?: string; message?: string } } | undefined)?.cause;
    const reason = (cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err)))
      .replace(/[^\x20-\x7E]/g, '').slice(0, 120);
    const message = `Authorization server ${endpoint} unreachable: ${reason}`;
    throw new AuthorizationServerUnavailableError(message, backoff?.pause(message));
  }
  const header = parseRetryAfter(response.headers.get('retry-after'));
  let retryAfterSeconds = header === undefined ? undefined : clampRetryAfter(header);
  if (backoff && (response.status === 429 || (pauseOnServerError && response.status >= 500))) {
    retryAfterSeconds = backoff.pause(`Authorization server ${endpoint} answered HTTP ${response.status}`, retryAfterSeconds);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AuthorizationServerUnavailableError(
      `Authorization server ${endpoint} answered HTTP ${response.status} without a JSON object`, retryAfterSeconds
    );
  }
  return { status: response.status, body: body as Record<string, unknown>, retryAfterSeconds };
}

/** Wait for a shared promise, but stop waiting (without cancelling it) when this caller's signal aborts. */
export function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * RFC 8693 token exchange: the client's opaque token (the subject token) for a Carbone API JWT, which is the
 * per-call API key. The JWT is cached per subject token (keyed by its SHA-256) until 30 s before it expires, in a
 * bounded LRU, and concurrent calls for one subject token share a single request. A `test_` JWT (a test account)
 * is used as is, exactly like a test API key.
 */
export class TokenExchange {
  private readonly cache: LruCache<string>;
  /** Subject tokens whose JWT was renewed in the last minute. */
  private readonly renewed: LruCache<true>;
  /** Subject tokens the exchange refused in the last minute, with the error code. */
  private readonly refused: LruCache<string>;
  /** Subject tokens whose exchange failed otherwise (e.g. a 5xx), until when: one try per Retry-After, nobody else paused. */
  private readonly failing: LruCache<number>;
  private readonly now: () => number;
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(private readonly options: {
    tokenEndpoint: string;
    credentials: OAuthClientCredentials;
    fetch?: typeof fetch;
    now?: () => number;
    maxEntries?: number;
    backoff?: Backoff;
  }) {
    // As many as the verdict cache: below the number of active users, every request would exchange again.
    this.cache = new LruCache(options.maxEntries ?? 10_000, options.now);
    this.renewed = new LruCache(options.maxEntries ?? 10_000, options.now);
    this.refused = new LruCache(options.maxEntries ?? 10_000, options.now);
    this.failing = new LruCache(options.maxEntries ?? 10_000, options.now);
    this.now = options.now ?? Date.now;
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  /**
   * The Carbone API key for this subject token. `signal` stops this caller's wait only: the shared exchange
   * still completes and is cached for the next call. Throws SubjectTokenRejectedError or
   * AuthorizationServerUnavailableError.
   */
  exchange(subjectToken: string, signal?: AbortSignal): Promise<string> {
    // The client left: nothing to exchange for.
    if (signal?.aborted) return Promise.reject(signal.reason);
    const key = tokenCacheKey(subjectToken);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const refused = this.refused.get(key);
    if (refused) return Promise.reject(new SubjectTokenRejectedError(refused, true));
    const failingUntil = this.failing.get(key);
    if (failingUntil !== undefined) {
      return Promise.reject(new AuthorizationServerUnavailableError('Token exchange failed a moment ago', Math.max(1, Math.ceil((failingUntil - this.now()) / 1000))));
    }
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.request(subjectToken, key).finally(() => this.inFlight.delete(key));
      // A caller that stopped waiting (its client left) must not leave a failure unhandled: it would stop the process.
      pending.catch(() => {});
      this.inFlight.set(key, pending);
    }
    return untilAborted(pending, signal);
  }

  /**
   * Forget the JWT cached for this subject token. With `staleKey`, only while it is still the cached one, so
   * concurrent calls refused with the same JWT trigger one new exchange, not one each; and false, forgetting
   * nothing, when this subject token was already renewed in the last minute: the Carbone API refuses its account
   * itself, and exchanging again would only repeat that.
   */
  invalidate(subjectToken: string, staleKey?: string): boolean {
    const key = tokenCacheKey(subjectToken);
    if (staleKey !== undefined) {
      // Renewed by a concurrent call already, or being renewed: the next exchange gets the new JWT.
      const cached = this.cache.get(key);
      if ((cached !== undefined && cached !== staleKey) || this.inFlight.has(key)) return true;
      if (this.renewed.get(key)) return false;
      this.renewed.set(key, true, RENEWAL_INTERVAL_MS);
    }
    this.cache.delete(key);
    return true;
  }

  private async request(subjectToken: string, key: string): Promise<string> {
    const { status, body, retryAfterSeconds } = await postToAuthorizationServer(
      this.options.tokenEndpoint,
      {
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        requested_token_type: ACCESS_TOKEN_TYPE,
      },
      this.options.credentials,
      this.options.fetch,
      this.options.backoff,
      false // an exchange failing for one account (5xx) must not stop sign-ins for the others
    );
    const accessToken = body['access_token'];
    if (status === 200 && typeof accessToken === 'string' && accessToken) {
      const expiresIn = body['expires_in'];
      const ttlMs = typeof expiresIn === 'number' && Number.isFinite(expiresIn) ? expiresIn * 1000 - EXPIRY_MARGIN_MS : DEFAULT_JWT_TTL_MS;
      if (ttlMs > 0) this.cache.set(key, accessToken, ttlMs);
      return accessToken;
    }
    const error = typeof body['error'] === 'string' ? body['error'] : undefined;
    // The client's token is unusable (unknown, expired, revoked, unbound, or without doc_rwd): sign in again.
    // RFC 8693 §2.2.2 answers invalid_request for any unusable subject; invalid_grant is what a plain RFC 6749
    // server would say instead.
    if (status === 400 && (error === 'invalid_request' || error === 'invalid_grant')) {
      this.refused.set(key, error, REFUSED_SUBJECT_SECONDS * 1000);
      throw new SubjectTokenRejectedError(error);
    }
    // Anything else (invalid_client, unauthorized_client, invalid_target, invalid_scope for a scope this server
    // never sends, 429, 5xx) is this server's problem, retried for this token after its Retry-After.
    const waitMs = (retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS) * 1000;
    this.failing.set(key, this.now() + waitMs, waitMs);
    throw new AuthorizationServerUnavailableError(
      `Token exchange failed: HTTP ${status}${error ? ` ${error.replace(/[^\x20-\x7E]/g, '').slice(0, 64)}` : ''}`, retryAfterSeconds
    );
  }
}
