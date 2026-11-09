import { createHash } from 'node:crypto';

/**
 * Who calls, for what a request starts and a later one comes back to (an async render job, an upload URL's limits):
 * the OAuth subject, the caller's API key, or '' for the server's own key (anyone who may use the server).
 * The subject, not the token: a token refreshed in between still finds the same caller.
 */
export function callerIdFrom(ctx: { http?: { authInfo?: { token: string; extra?: Record<string, unknown> } } }): string {
  const authInfo = ctx.http?.authInfo;
  const sub = authInfo?.extra?.['sub'];
  return typeof sub === 'string' && sub ? `sub:${sub}` : authInfo?.token ? `key:${authInfo.token}` : '';
}

/**
 * Who calls, as the access log names them: `sub:<OAuth subject>` (an account ID, not a secret), or `key:<first 12 hex
 * characters of the key's SHA-256>`, never the key itself; undefined for the server's own key.
 */
export function loggedCaller(authInfo: { token: string; extra?: Record<string, unknown> } | undefined): string | undefined {
  const sub = authInfo?.extra?.['sub'];
  if (typeof sub === 'string' && sub) return `sub:${sub.slice(0, 100)}`;
  return authInfo?.token ? `key:${createHash('sha256').update(authInfo.token).digest('hex').slice(0, 12)}` : undefined;
}
