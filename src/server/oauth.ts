import {
  bearerAuthChallengeResponse,
  buildOAuthProtectedResourceMetadata,
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
  verifyBearerToken,
  type AuthInfo,
  type OAuthProtectedResourceMetadata,
  type OAuthTokenVerifier,
  type VerifyBearerTokenOptions,
} from '@modelcontextprotocol/server';
import { CarboneAuthError, CarboneConnectionError, SIGN_IN_REFUSED_MESSAGE } from '../carbone/errors.js';
import {
  AuthorizationServerUnavailableError,
  Backoff,
  REFUSED_SUBJECT_SECONDS,
  SubjectTokenRejectedError,
  TokenExchange,
  logOAuth,
  postToAuthorizationServer,
  type OAuthClientCredentials,
} from '../carbone/tokenExchange.js';
import { LruCache, tokenCacheKey } from '../utils/lru.js';
import type { OAuthConfig } from './config.js';

/**
 * HTTP OAuth mode (Carbone's hosted server): the MCP server is an OAuth 2.1 resource server. A Bearer that is not
 * a Carbone API key is introspected at the authorization server, checked by the SDK (audience = this resource,
 * scope doc_rwd, expiry), then exchanged for a short-lived Carbone API JWT, the only token sent to the Carbone API.
 */

export const REQUIRED_SCOPE = 'doc_rwd';

/** RFC 6750 §2.1: Bearer credentials are the scheme (any case), one or more spaces, and a b64token. */
const BEARER_CREDENTIALS = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i;

/** An active verdict is used without asking again for this long. */
const FRESH_VERDICT_MS = 60_000;
/** While the authorization server is paused (it failed or throttled), an active verdict is still used this long after its last check (never past the token's expiry). */
const STALE_VERDICT_MS = 10 * 60_000;
/** An active verdict is kept this long past the token's expiry, so the expired token is refused without a request. */
const EXPIRED_VERDICT_KEPT_MS = 60 * 60_000;
/** An inactive verdict is reused this long: a token refused a moment ago is refused again without a request. */
const INACTIVE_VERDICT_TTL_MS = 10_000;
/**
 * Introspections of tokens never seen, per minute, all clients together: kept well below the authorization
 * server's own rate limit, so checking again the users already signed in always has room.
 */
const UNSEEN_INTROSPECTIONS_PER_MINUTE = 1000;
/**
 * Introspections that found no active token, per client address and per minute, before 429. Applied only once
 * half of the budget above is used: a busy shared address (a hosted MCP client) is never limited in normal times.
 */
const FAILED_INTROSPECTIONS_PER_MINUTE = 60;

/**
 * Whether a token is a Carbone API JWT: a compact JWS, optionally prefixed "test_", with exactly three non-empty
 * base64url segments, a JSON-object header with an "alg", and a JSON-object payload whose "aud" is "carbone".
 * It covers a user's API key and a JWT the authorization server minted through OAuth. Neither was issued for this
 * server, so OAuth mode refuses both without asking the authorization server. It is decoded, never verified.
 * Exported for tests.
 */
export function isCarboneJwt(token: string): boolean {
  const segments = token.replace(/^test_/, '').split('.');
  if (segments.length !== 3 || !segments.every((segment) => /^[A-Za-z0-9_-]+$/.test(segment))) return false;
  if (typeof decodeJsonSegment(segments[0])?.['alg'] !== 'string') return false;
  return decodeJsonSegment(segments[1])?.['aud'] === 'carbone';
}

function decodeJsonSegment(segment: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** An introspection answer: the token's AuthInfo without the token itself, or null when it is not active. */
type Verdict = Omit<AuthInfo, 'token'> | null;
/** An active verdict, with when the authorization server last confirmed it. */
type ActiveVerdict = { info: Omit<AuthInfo, 'token'> & { expiresAt: number }; checkedAt: number };
/** A count over a fixed one-minute window. */
type MinuteWindow = { count: number; resetAt: number; reported?: boolean };

/** Too many introspections from one client address found no active token: answered 429, without asking. */
export class TooManyFailedAttemptsError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests with a token that is not valid');
    this.name = 'TooManyFailedAttemptsError';
  }
}

/**
 * The key a client address is limited by: an IPv4 address (also when IPv4-mapped), or the /64 network of an
 * IPv6 one, the smallest block a single subscriber is usually given.
 */
export function addressKey(address: string): string {
  const ipv4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (ipv4) return ipv4[1];
  if (!address.includes(':')) return address.slice(0, 64);
  const [head, tail] = address.replace(/%.*$/, '').split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((group) => (parseInt(group, 16) || 0).toString(16)).join(':')}::/64`;
}

/**
 * OAuthTokenVerifier backed by RFC 7662 introspection (client_secret_basic), keyed by the token's SHA-256.
 * - An active verdict is used for 60 s, then checked again. While the authorization server is paused (Backoff: it
 *   failed or throttled), it is still used for up to 10 min after its last check, never past the token's expiry.
 * - A token past its expiry is refused without a request; an inactive one, or an active one without a future
 *   expiry, is refused for 10 s without a request. Inactive verdicts have their own LRU, so fake tokens cannot
 *   evict the active ones.
 * - A token never seen is introspected within two one-minute budgets: all clients together (beyond: 503), and its
 *   client address's introspections that found no active token (beyond: 429, once the first is half used).
 * Concurrent checks of one token share a single request. The audience and scope checks are the SDK's
 * (verifyBearerToken), so this only reports what the authorization server said.
 */
export class IntrospectionVerifier implements OAuthTokenVerifier {
  private readonly active: LruCache<ActiveVerdict>;
  private readonly inactive: LruCache<true>;
  /** Per client address: its introspections that found no active token, this minute. */
  private readonly failures: LruCache<MinuteWindow>;
  /** All clients together: introspections of tokens never seen, this minute. */
  private unseen: MinuteWindow = { count: 0, resetAt: 0 };
  private readonly inFlight = new Map<string, Promise<Verdict>>();
  private readonly now: () => number;
  private readonly backoff: Backoff;
  /** When serving a last verdict was last logged: at most once a minute. */
  private staleReportedAt = -Infinity;
  /** The log names one limited address every 10 s at most, and counts the others. */
  private limitedReportedAt = -Infinity;
  private limitedUnreported = 0;

  constructor(private readonly options: {
    introspectionEndpoint: string;
    credentials: OAuthClientCredentials;
    fetch?: typeof fetch;
    now?: () => number;
    maxEntries?: number;
    backoff?: Backoff;
  }) {
    this.now = options.now ?? Date.now;
    this.active = new LruCache(options.maxEntries ?? 10_000, this.now);
    this.inactive = new LruCache(options.maxEntries ?? 10_000, this.now);
    this.failures = new LruCache(10_000, this.now);
    this.backoff = options.backoff ?? new Backoff(this.now);
  }

  get cacheSize(): number {
    return this.active.size + this.inactive.size;
  }

  cacheKeys(): string[] {
    return [...this.active.keys(), ...this.inactive.keys()];
  }

  verifyAccessToken(token: string): Promise<AuthInfo> {
    return this.verify(token);
  }

  /** Forget the active verdict of this token: the next check asks the authorization server again. */
  forget(token: string): void {
    this.active.delete(tokenCacheKey(token));
  }

  /** verifyAccessToken, with the client address whose budgets pay for introspecting a token never seen. */
  async verify(token: string, clientAddress?: string): Promise<AuthInfo> {
    const key = tokenCacheKey(token);
    if (this.inactive.get(key)) throw new OAuthError(OAuthErrorCode.InvalidToken, 'The access token is not active');
    const now = this.now();
    const known = this.active.get(key);
    if (known && now >= known.info.expiresAt * 1000) throw new OAuthError(OAuthErrorCode.InvalidToken, 'The access token has expired');
    if (known && now < known.checkedAt + FRESH_VERDICT_MS) return { ...known.info, token };

    // A token never seen is introspected within the budgets; a known one is only being checked again.
    // While paused, a token never seen waits (503) without a request or a charge; joining a check already under
    // way costs nothing more.
    if (!known) this.backoff.check();
    const charged = known || clientAddress === undefined || this.inFlight.has(key) ? undefined : this.admit(addressKey(clientAddress));
    let verdict: Verdict;
    try {
      let pending = this.inFlight.get(key);
      if (!pending) {
        pending = this.introspect(token, key, known !== undefined).finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, pending);
      }
      verdict = await pending;
    } catch (err) {
      if (charged) charged.count--;
      if (err instanceof AuthorizationServerUnavailableError && known && this.backoff.active && now < known.checkedAt + STALE_VERDICT_MS) {
        if (now >= this.staleReportedAt + 60_000) {
          this.staleReportedAt = now;
          logOAuth(`${err.message}: signed-in users are served from their last check, for up to ${STALE_VERDICT_MS / 60_000} min`);
        }
        return { ...known.info, token };
      }
      throw err;
    }
    if (verdict === null) throw new OAuthError(OAuthErrorCode.InvalidToken, 'The access token is not active');
    if (charged) charged.count--;
    return { ...verdict, token };
  }

  /**
   * Admit the introspection of a token never seen from `address`, or throw: 503 when the budget of all clients is
   * spent, 429 when this address's is too, under pressure. Returns the address's window: its count is given back
   * when the token turns out active or the server does not answer.
   */
  private admit(address: string): MinuteWindow {
    const now = this.now();
    if (now >= this.unseen.resetAt) this.unseen = { count: 0, resetAt: now + 60_000 };
    const secondsLeft = (window: MinuteWindow) => Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    if (this.unseen.count >= UNSEEN_INTROSPECTIONS_PER_MINUTE) {
      if (!this.unseen.reported) {
        this.unseen.reported = true;
        logOAuth(`${UNSEEN_INTROSPECTIONS_PER_MINUTE} tokens never seen were checked within a minute: the next ones wait ${secondsLeft(this.unseen)} s`);
      }
      throw new AuthorizationServerUnavailableError('Too many tokens to check: retry later', secondsLeft(this.unseen));
    }
    let failures = this.failures.get(address);
    if (!failures) this.failures.set(address, (failures = { count: 0, resetAt: now + 60_000 }), 60_000);
    if (failures.count >= FAILED_INTROSPECTIONS_PER_MINUTE && this.unseen.count >= UNSEEN_INTROSPECTIONS_PER_MINUTE / 2) {
      if (!failures.reported) {
        failures.reported = true;
        if (now < this.limitedReportedAt + 10_000) {
          this.limitedUnreported++;
        } else {
          const others = this.limitedUnreported ? ` (and ${this.limitedUnreported} more address(es) since the last report)` : '';
          logOAuth(`${address} sent too many tokens that are not valid: its unseen tokens get 429 for ${secondsLeft(failures)} s${others}`);
          this.limitedReportedAt = now;
          this.limitedUnreported = 0;
        }
      }
      throw new TooManyFailedAttemptsError(secondsLeft(failures));
    }
    this.unseen.count++;
    failures.count++;
    return failures;
  }

  /**
   * Checking a known token again pauses every call after any failure (an outage). A token never seen pauses them
   * only after a 429: no token an attacker picks can stop sign-ins for everyone by making the server fail.
   */
  private async introspect(token: string, key: string, known: boolean): Promise<Verdict> {
    const { status, body, retryAfterSeconds } = await postToAuthorizationServer(
      this.options.introspectionEndpoint, { token }, this.options.credentials, this.options.fetch, known ? this.backoff : undefined
    );
    // 401 invalid_client, 429 and 5xx are this server's problem: 503, never a 401 that sends the client to sign in.
    if (status !== 200) {
      const message = `Token introspection failed: HTTP ${status}`;
      throw new AuthorizationServerUnavailableError(message, !known && status === 429 ? this.backoff.pause(message, retryAfterSeconds) : retryAfterSeconds);
    }
    const { scope, client_id: clientId, exp, sub } = body;
    // Inactive, or active without a future expiry (which the SDK would refuse anyway): refused for 10 s.
    if (body['active'] !== true || typeof exp !== 'number' || exp * 1000 <= this.now()) {
      this.active.delete(key);
      this.inactive.set(key, true, INACTIVE_VERDICT_TTL_MS);
      return null;
    }
    const aud = Array.isArray(body['aud']) && body['aud'].length === 1 ? body['aud'][0] : body['aud'];
    const info: ActiveVerdict['info'] = {
      clientId: typeof clientId === 'string' ? clientId : '',
      scopes: typeof scope === 'string' ? scope.split(' ').filter(Boolean) : [],
      expiresAt: exp,
      // The audience the SDK compares with expectedResource; none (or not a URL) means "not for this resource".
      ...(typeof aud === 'string' && URL.canParse(aud) && { resource: new URL(aud) }),
      extra: { sub },
    };
    this.active.set(key, { info, checkedAt: this.now() }, exp * 1000 + EXPIRED_VERDICT_KEPT_MS - this.now());
    return info;
  }
}

/**
 * The RFC 9728 Protected Resource Metadata document. `resource` is the configured string itself: the SDK emits
 * URL.href, which gives an origin-only URL a trailing slash ("https://mcp.carbone.io/"), whereas clients compare
 * `resource` with the URL they connect to, as a string.
 */
export function protectedResourceMetadata(
  config: Pick<OAuthConfig, 'issuer' | 'resourceUrl'>
): OAuthProtectedResourceMetadata & { bearer_methods_supported: string[] } {
  return {
    ...buildOAuthProtectedResourceMetadata({
      resourceServerUrl: new URL(config.resourceUrl),
      oauthMetadata: {
        issuer: config.issuer,
        authorization_endpoint: new URL('/authorize', config.issuer).href,
        token_endpoint: new URL('/api/oauth/token', config.issuer).href,
        response_types_supported: ['code'],
      },
      scopesSupported: [REQUIRED_SCOPE],
    }),
    resource: config.resourceUrl,
    bearer_methods_supported: ['header'],
  };
}

export interface OAuthGate {
  /** The RFC 9728 document, as JSON. */
  readonly metadataJson: string;
  /** Where it is served: the path-suffixed well-known URI clients try first, and the root one. */
  readonly metadataPaths: ReadonlySet<string>;
  /** Advertised in every WWW-Authenticate challenge. */
  readonly resourceMetadataUrl: string;
  /**
   * Authenticate one MCP request carrying an OAuth Bearer (or none). Resolves to the AuthInfo to hand to the MCP
   * handler, whose token is the exchanged Carbone API key, or to the 400/401/403 challenge (or 429) Response to
   * answer. Throws AuthorizationServerUnavailableError (answer 503). `signal` stops waiting for the token exchange;
   * `clientAddress` pays for introspecting a token never seen: without it (tests), no budget applies. Rejects with
   * the signal's reason when the client left before the exchange.
   */
  authenticate(authorization: string | undefined, signal?: AbortSignal, clientAddress?: string): Promise<AuthInfo | Response>;
}

export function createOAuthGate(
  config: OAuthConfig,
  options: { fetch?: typeof fetch; now?: () => number } = {}
): OAuthGate {
  const credentials = { clientId: config.clientId, clientSecret: config.clientSecret };
  const resource = new URL(config.resourceUrl);
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resource);
  const metadataJson = JSON.stringify(protectedResourceMetadata(config));
  // One pause for every call to the authorization server, introspection and exchange alike.
  const backoff = new Backoff(options.now);
  const exchanger = new TokenExchange({ tokenEndpoint: new URL('/api/oauth/token', config.issuer).href, credentials, ...options, backoff });
  const verifier = new IntrospectionVerifier({ introspectionEndpoint: new URL('/api/oauth/introspect', config.issuer).href, credentials, ...options, backoff });
  const bearer: VerifyBearerTokenOptions = {
    verifier,
    expectedResource: resource,
    requiredScopes: [REQUIRED_SCOPE],
    resourceMetadataUrl,
  };

  /**
   * CallOptions.refreshKey: a new exchange after the Carbone API refused `staleKey`. It runs inside a tool call,
   * where no HTTP status can be sent any more, so its failures are reported as Carbone errors.
   */
  const refreshKeyFor = (subjectToken: string, staleKey: string) => async (signal?: AbortSignal): Promise<string> => {
    // Renewed already in the last minute: the Carbone API refuses this account itself, exchanging again won't help.
    if (!exchanger.invalidate(subjectToken, staleKey)) throw new CarboneAuthError(SIGN_IN_REFUSED_MESSAGE);
    try {
      return await exchanger.exchange(subjectToken, signal);
    } catch (err) {
      if (err instanceof SubjectTokenRejectedError) {
        // Its last verdict no longer holds: the next request asks again, and a revoked token gets its 401 at once.
        if (!err.repeated) verifier.forget(subjectToken);
        throw new CarboneAuthError('Your Carbone sign-in has expired or was revoked: sign in again from your MCP client.');
      }
      if (err instanceof AuthorizationServerUnavailableError) {
        throw new CarboneConnectionError('The Carbone authorization server is unavailable: try again in a moment.', err);
      }
      throw err;
    }
  };

  /**
   * The RFC 6750 §3 challenge for a request that brought no usable token. Without credentials it carries no error
   * code (§3.1), which the SDK's bearerAuthChallengeResponse always writes: that one answers only the tokens that
   * fail verification (invalid_token, insufficient_scope).
   */
  const challenge = (status: 400 | 401, error?: { code: string; description: string }): Response => {
    const params = [
      ...(error ? [`error="${error.code}"`, `error_description="${error.description}"`] : []),
      `scope="${REQUIRED_SCOPE}"`,
      `resource_metadata="${resourceMetadataUrl}"`,
    ];
    const headers = { 'WWW-Authenticate': `Bearer ${params.join(', ')}` };
    return error
      ? Response.json({ error: error.code, error_description: error.description }, { status, headers })
      : new Response(null, { status, headers });
  };

  return {
    metadataJson,
    metadataPaths: new Set([new URL(resourceMetadataUrl).pathname, '/.well-known/oauth-protected-resource']),
    resourceMetadataUrl,
    async authenticate(authorization, signal, clientAddress) {
      // No credentials (no header, another scheme, or a Bearer without a token): the bare challenge, no error code.
      const header = authorization?.trim() ?? '';
      if (!/^Bearer( |$)/i.test(header) || /^Bearer *$/i.test(header)) return challenge(401);
      // A token outside the b64token syntax is a malformed request (RFC 6750 §3.1), never verified.
      const token = BEARER_CREDENTIALS.exec(header)?.[1];
      if (token === undefined) {
        return challenge(400, { code: 'invalid_request', description: "The Authorization header must be 'Bearer <token>'" });
      }
      // A Carbone API JWT (an API key, or one minted through OAuth for another client or without an RFC 8707
      // resource) is not a token for this server: refused without asking the authorization server.
      if (isCarboneJwt(token)) {
        return bearerAuthChallengeResponse(new OAuthError(OAuthErrorCode.InvalidToken, 'The token was not issued for this server: sign in, or use an API key with a self-hosted server'), bearer);
      }
      try {
        const authInfo = await verifyBearerToken(`Bearer ${token}`, { ...bearer, verifier: { verifyAccessToken: (t) => verifier.verify(t, clientAddress) } });
        const key = await exchanger.exchange(authInfo.token, signal).catch(async (err: unknown) => {
          if (!(err instanceof SubjectTokenRejectedError)) throw err;
          // Revoked since its last check: asking again refuses it (401, then 10 s without a request).
          if (!err.repeated) {
            verifier.forget(authInfo.token);
            await verifier.verify(authInfo.token);
          }
          // Refused while still active: the authorization server contradicts itself about this token. This server's
          // problem (503), for this token only, asked again once the refusal is forgotten.
          throw new AuthorizationServerUnavailableError('The authorization server refused to exchange an active token', REFUSED_SUBJECT_SECONDS);
        });
        // The client's own token stops here: the request carries the exchanged key, and the means to renew it.
        return { ...authInfo, token: key, extra: { ...authInfo.extra, refreshKey: refreshKeyFor(authInfo.token, key) } };
      } catch (err) {
        if (err instanceof TooManyFailedAttemptsError) {
          return Response.json(
            { error: 'too_many_requests', error_description: `${err.message}: retry later` },
            { status: 429, headers: { 'Retry-After': String(err.retryAfterSeconds) } }
          );
        }
        if (err instanceof OAuthError) return bearerAuthChallengeResponse(err, bearer);
        throw err;
      }
    },
  };
}
