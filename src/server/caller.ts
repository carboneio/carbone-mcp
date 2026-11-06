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
