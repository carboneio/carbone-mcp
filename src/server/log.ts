import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * HTTP mode's log: one logfmt line per event on stderr, `level=` first so log viewers detect the level
 * (`level=info msg=request method=POST path=/ status=200 ms=12 ip=203.0.113.7 rid=9f2c1a7b04d6e358`). Never a token or
 * an API key. Tool arguments and results are not logged, except the first 200 characters of a tool or resource error,
 * with URLs reduced to their host and long tokens redacted.
 */

export type LogLevel = 'info' | 'warn' | 'error';

/** What the access line reports about one HTTP request, filled in while it runs: by http.ts, and by withOutcome. */
export interface RequestLog {
  /** 16 hex characters, also added to every line written while the request runs, and sent as X-Request-Id. */
  rid: string;
  /**
   * The JSON-RPC method (`batch` for a batch), the tool called, the client's name/version, the Mcp-Protocol-Version
   * and User-Agent headers (client input, clipped).
   */
  mcp?: string;
  tool?: string;
  client?: string;
  proto?: string;
  ua?: string;
  /** `sub:<OAuth subject>` or `key:<SHA-256 prefix of the API key>` (see loggedCaller), never the token itself. */
  user?: string;
  /** OAuth mode: the client ID the token was issued to. */
  oauthClient?: string;
  /** Why the OAuth gate answered 401: no-token or invalid-token. */
  reason?: string;
  outcome?: 'ok' | 'error';
  /** A tool or resource error's text, through errorSummary. */
  error?: string;
  /** Set by formatError: a Carbone outage (upstream) or a bug (internal), rather than a request the client got wrong. */
  fault?: 'upstream' | 'internal';
}

/** The current HTTP request's record; undefined outside one (stdio, startup, background checks). */
export const requestLog = new AsyncLocalStorage<RequestLog>();

/**
 * A logfmt value: at most 300 characters, printable ASCII only, so no value can forge a line; quoted when it holds a
 * space, =, " or \, or nothing.
 */
function logfmtValue(value: string | number): string {
  const text = String(value).slice(0, 300).replace(/[^\x20-\x7E]/g, '');
  return text === '' || /[ ="\\]/.test(text) ? `"${text.replace(/["\\]/g, '\\$&')}"` : text;
}

/** Write one logfmt line; undefined fields are left out. Inside an HTTP request, its rid is added. */
export function log(level: LogLevel, fields: Record<string, string | number | undefined>): void {
  let line = `level=${level}`;
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) line += ` ${key}=${logfmtValue(value)}`;
  const rid = requestLog.getStore()?.rid;
  process.stderr.write(`${line}${rid ? ` rid=${rid}` : ''}\n`);
}

/**
 * An error text for the log, which may echo what the user sent: at most 200 characters; any other character than
 * printable ASCII becomes a space first, so nothing is glued together once scrubbed; every URL is reduced to its scheme
 * and host (a path can be a secret too: a render link, a shared file ID), and what is left of a query or fragment
 * dropped (only when it holds a =, so that "Template #3" stays); data: URIs and runs of 40+ base64 or hex characters
 * (tokens, keys, signatures) are redacted. Exported for tests.
 */
export function errorSummary(text: string): string {
  return text.slice(0, 1000)
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)(?:[^\s/?#]*@)?([^\s/?#@]*)\S*/gi, '$1$2')
    .replace(/[?#][^\s=]*=\S*/g, '')
    .replace(/\bdata:\S+/gi, 'data:...')
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, '[redacted]')
    .slice(0, 200);
}

/**
 * A tool or resource callback that records its outcome for the access line: `error`, with the result's first text,
 * when it returns isError or throws; `ok` otherwise, unless an earlier call of the request failed. Outside an HTTP
 * request (stdio), it only calls through.
 */
export function withOutcome<A extends unknown[], R>(callback: (...args: A) => R | Promise<R>): (...args: A) => Promise<R> {
  return async (...args) => {
    const record = requestLog.getStore();
    if (!record) return callback(...args);
    const failed = (text: unknown) => {
      record.outcome = 'error';
      record.error ??= typeof text === 'string' ? errorSummary(text) : undefined;
    };
    try {
      const result = await callback(...args);
      const { isError, content } = (result ?? {}) as { isError?: unknown; content?: unknown };
      if (isError === true) failed(Array.isArray(content) ? content.find((item) => item?.type === 'text')?.text : undefined);
      else record.outcome ??= 'ok';
      return result;
    } catch (err) {
      failed(err instanceof Error ? err.message : String(err));
      throw err;
    }
  };
}

/**
 * Exit with `code` once stderr has written what was logged before (to a pipe, writes are asynchronous), or after 1 s if
 * it never does, so that a stuck pipe cannot keep the process alive.
 */
export function exitWhenFlushed(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 1000).unref();
  process.stderr.write('', () => process.exit(code));
}
