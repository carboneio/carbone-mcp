import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CarboneClient } from '../carbone/client.js';
import { CarboneAuthError, CarboneError } from '../carbone/errors.js';
import { formatError } from '../utils/errors.js';
import { describeUpload } from '../tools/templates.js';
import { AuthorizationServerUnavailableError } from '../carbone/tokenExchange.js';
import { callerIdFrom } from './caller.js';
import { UPLOAD_PATH, type UploadCredential, type UploadFields, type UploadTicket, type UploadTicketSealer } from './uploadTicket.js';

/**
 * Upload URLs (HTTP only, when MCP_TICKET_SECRET is set): upload_template with requestUploadUrl issues a ticket,
 * and the file is then sent to UPLOAD_PATH, outside the MCP messages, so it never passes through the model as base64.
 * The route streams it into Carbone's POST /template as it arrives: nothing is stored here, and memory stays flat
 * whatever the file size. The ticket is bound to the file's size and SHA-256: whoever holds it can only upload that
 * file again, and a file that differs is cut off before Carbone stores it.
 */

/** The ticket travels in a header, never in the URL, so it stays out of access logs. */
export const UPLOAD_TICKET_HEADER = 'X-Upload-Token';
/** How long an upload URL stays valid, at most: until the caller's own sign-in expires if that comes first. */
const UPLOAD_TICKET_TTL_SECONDS = 600;
/**
 * Uploads streamed at the same time by one instance (memory stays flat, so it is the sockets that are bounded), by one
 * caller, and with one ticket; more are told to retry. Instances count separately: across N instances, N times that.
 */
export const MAX_CONCURRENT_UPLOADS = 16;
export const MAX_CONCURRENT_UPLOADS_PER_CALLER = 2;
/**
 * The slowest upload kept: its first bytes within startMs once it can be read, then at least this many bytes every
 * window (or the rest of the file), about 35 KB/s, so a client sending nothing or trickling bytes cannot hold upload
 * slots. Checked only while the file arrives, not while Carbone stores it.
 */
export const MIN_UPLOAD_RATE = { startMs: 5_000, bytes: 1024 * 1024, windowMs: 30_000 };
/** Time for Carbone to receive and store the file. The HTTP server lets an upload request last that long. */
export const UPLOAD_TIMEOUT_MS = 300_000;

/** What upload_template returns in requestUploadUrl mode. */
interface IssuedUpload {
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: number;
}

export interface UploadIssuer {
  issue(request: { size: number; sha256: string; fields: UploadFields }, caller: UploadCaller): IssuedUpload;
}

/** Who asked for the upload URL: who they are (callerIdFrom), the credential the upload will use, and when the caller's sign-in expires. */
export interface UploadCaller {
  id: string;
  credential: UploadCredential;
  expiresAt?: number;
}

/**
 * The caller of an MCP request, from its auth info. OAuth mode gives the caller's own token through
 * `extra.uploadSubject()` (see src/server/oauth.ts): it is sealed in the ticket and exchanged again when the file arrives, since the
 * exchanged key the request carries may expire before. API-key mode: the caller's key. Neither: the server's key.
 */
export function uploadCallerFrom(ctx: { http?: { authInfo?: { token: string; expiresAt?: number; extra?: Record<string, unknown> } } }): UploadCaller {
  const authInfo = ctx.http?.authInfo;
  const id = callerIdFrom(ctx);
  const subject = authInfo?.extra?.['uploadSubject'];
  if (typeof subject === 'function') return { id, credential: { subjectToken: String(subject()) }, expiresAt: authInfo?.expiresAt };
  if (authInfo?.token) return { id, credential: { apiKey: authInfo.token } };
  return { id, credential: { serverKey: true } };
}

export function createUploadIssuer(options: {
  sealer: UploadTicketSealer;
  /** The server's public origin, e.g. "https://mcp.carbone.io". */
  publicUrl: string;
  now?: () => number;
}): UploadIssuer {
  const now = options.now ?? Date.now;
  const uploadUrl = new URL(UPLOAD_PATH, options.publicUrl).href;
  return {
    issue(request, caller) {
      const nowSeconds = Math.floor(now() / 1000);
      const exp = Math.min(nowSeconds + UPLOAD_TICKET_TTL_SECONDS, caller.expiresAt ?? Infinity);
      const ticket: UploadTicket = {
        exp,
        nonce: randomBytes(16).toString('hex'),
        credential: caller.credential,
        caller: caller.id && createHash('sha256').update(caller.id).digest('hex'),
        size: request.size,
        sha256: request.sha256.toLowerCase(),
        fields: request.fields,
      };
      return {
        uploadUrl,
        headers: { [UPLOAD_TICKET_HEADER]: options.sealer.seal(ticket) },
        expiresAt: exp,
      };
    },
  };
}

/** How the body is doing: bytes read so far, whether it all arrived, and whether its SHA-256 was wrong. */
interface BodyProgress {
  received: number;
  done: boolean;
  wrongHash?: boolean;
}

/**
 * The request body, counted and hashed as it streams. Its length is the ticket's (Content-Length is checked first,
 * and a body cut short throws), so only the hash is left to check: when it is wrong, `progress.wrongHash` records it
 * (however the client then wraps the error) and the throw comes before the final multipart boundary is sent, so
 * Carbone never receives a complete upload.
 */
async function* verifiedBody(req: IncomingMessage, ticket: UploadTicket, progress: BodyProgress): AsyncGenerator<Uint8Array> {
  const hash = createHash('sha256');
  for await (const chunk of req as AsyncIterable<Buffer>) {
    progress.received += chunk.length;
    hash.update(chunk);
    yield chunk;
  }
  progress.done = true;
  if (hash.digest('hex') !== ticket.sha256) {
    progress.wrongHash = true;
    throw new Error('Upload refused: wrong SHA-256');
  }
}

/** The multipart fields, in the order Carbone needs (versioning, id and salt before the file). */
export function uploadFormFields(ticket: UploadTicket): Array<[string, string]> {
  const f = ticket.fields;
  const fields: Array<[string, string]> = f.versioning
    ? [['versioning', 'true'], ...(f.id ? [['id', f.id] as [string, string]] : [])]
    // Without versioning the Version ID is the SHA-256 of salt + file. Without a salt it would be the file's alone,
    // and upload into an identical template already stored, resetting its name, tags and expiry. The ticket's nonce
    // keeps it apart, and makes a replay of this ticket land on the same version instead of a new one.
    : [['salt', ticket.nonce]];
  if (f.name) fields.push(['name', f.name]);
  if (f.category) fields.push(['category', f.category]);
  if (f.comment) fields.push(['comment', f.comment]);
  if (f.tags) fields.push(['tags', JSON.stringify(f.tags)]);
  if (f.deployedAt !== undefined) fields.push(['deployedAt', String(f.deployedAt)]);
  if (f.expireAt !== undefined) fields.push(['expireAt', String(f.expireAt)]);
  return fields;
}

function sendJson(res: ServerResponse, req: IncomingMessage, status: number, body: unknown, headers: Record<string, string> = {}): void {
  // Answered before the whole body was read: close the connection rather than let Node drain the rest.
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers, ...(!req.complete && { Connection: 'close' }) });
  res.end(JSON.stringify(body));
}

/**
 * The UPLOAD_PATH handler. `exchange` turns an OAuth caller's own token into a Carbone API key (OAuth mode only).
 * Everything is checked before the body is read: the ticket, then the announced size, then the concurrency limits.
 * It answers "Expect: 100-continue" itself, so the server must route its 'checkContinue' event here (http.ts does).
 */
export function createUploadRoute(options: {
  sealer: UploadTicketSealer;
  client: CarboneClient;
  maxBytes: number;
  exchange?: (subjectToken: string, signal: AbortSignal) => Promise<string>;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  /** The tickets being uploaded on this instance, by nonce; and how many each caller has (not the server's own key). */
  const active = new Set<string>();
  const perCaller = new Map<string, number>();
  return async (req, res) => {
    if (req.method !== 'POST') {
      return sendJson(res, req, 405, { error: 'Send the file with POST.' }, { Allow: 'POST, OPTIONS' });
    }
    const header = req.headers[UPLOAD_TICKET_HEADER.toLowerCase()];
    if (typeof header !== 'string') {
      return sendJson(res, req, 401, { error: `Missing ${UPLOAD_TICKET_HEADER} header: send the one upload_template returned with the URL.` });
    }
    const ticket = options.sealer.open(header);
    if (!ticket) {
      return sendJson(res, req, 401, { error: 'This upload URL is invalid or has expired: call upload_template with requestUploadUrl again.' });
    }
    const length = req.headers['content-length'];
    if (length === undefined || req.headers['transfer-encoding']) {
      return sendJson(res, req, 411, { error: 'Send the file with a Content-Length, e.g. curl --data-binary @<file>.' });
    }
    if (Number(length) !== ticket.size) {
      return sendJson(res, req, 400, {
        error: `The body is ${length} bytes but this upload URL was issued for a ${ticket.size}-byte file: nothing was stored.`,
      });
    }
    if (ticket.size > options.maxBytes) {
      return sendJson(res, req, 413, { error: `The file is larger than this server's limit of ${options.maxBytes} bytes.` });
    }
    if (active.has(ticket.nonce)) {
      return sendJson(res, req, 409, { error: 'This upload URL is already in use by an upload in progress.' });
    }
    // A self-hosted server's own key is every caller's: only the instance limit applies to it.
    const caller = ticket.caller || undefined;
    if (active.size >= MAX_CONCURRENT_UPLOADS || (caller && (perCaller.get(caller) ?? 0) >= MAX_CONCURRENT_UPLOADS_PER_CALLER)) {
      return sendJson(res, req, 503, { error: 'Too many uploads in progress: retry in a few seconds.' }, { 'Retry-After': '5' });
    }

    active.add(ticket.nonce);
    if (caller) perCaller.set(caller, (perCaller.get(caller) ?? 0) + 1);
    // Checks passed: a client waiting for "100 Continue" (curl does for files over 1 MiB) may now send the file.
    if (/100-continue/i.test(req.headers.expect ?? '')) res.writeContinue();
    // Stop when the client goes away.
    const gone = new AbortController();
    res.once('close', () => gone.abort());
    const progress: BodyProgress = { received: 0, done: false };
    let watchdog: NodeJS.Timeout | undefined;
    let firstBytes: NodeJS.Timeout | undefined;
    try {
      const credential = ticket.credential;
      const apiKey = 'apiKey' in credential ? credential.apiKey
        : 'subjectToken' in credential ? await options.exchange!(credential.subjectToken, gone.signal)
        : undefined;
      // Drop an upload that does not start, or arrives too slowly; once it has all arrived, Carbone may take its time.
      firstBytes = setTimeout(() => { if (!progress.received) req.destroy(new Error('Upload not started')); }, MIN_UPLOAD_RATE.startMs);
      let seen = 0;
      watchdog = setInterval(() => {
        if (progress.done) return clearInterval(watchdog);
        if (progress.received - seen < Math.min(MIN_UPLOAD_RATE.bytes, ticket.size - seen)) req.destroy(new Error('Upload too slow'));
        seen = progress.received;
      }, MIN_UPLOAD_RATE.windowMs);
      const result = await options.client.uploadTemplateStream({
        fields: uploadFormFields(ticket),
        size: ticket.size,
        content: verifiedBody(req, ticket, progress),
        timeoutMs: UPLOAD_TIMEOUT_MS,
      }, { apiKey, signal: gone.signal });
      const { text, structuredContent } = describeUpload(result, ticket.fields.name);
      sendJson(res, req, 200, { ...structuredContent, message: text });
    } catch (err) {
      if (res.headersSent || gone.signal.aborted) return;
      if (progress.wrongHash) {
        return sendJson(res, req, 400, {
          error: 'The file sent does not have the SHA-256 the upload URL was issued for: nothing was stored. ' +
            'Check the file, then call upload_template with requestUploadUrl again.',
        });
      }
      if (err instanceof AuthorizationServerUnavailableError) {
        return sendJson(res, req, 503, { error: 'The authorization server could not be reached: retry later.' }, { 'Retry-After': String(err.retryAfterSeconds) });
      }
      const status = err instanceof CarboneAuthError ? 401
        : err instanceof CarboneError && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode
        : 502;
      sendJson(res, req, status, { error: formatError(err) });
    } finally {
      clearInterval(watchdog);
      clearTimeout(firstBytes);
      active.delete(ticket.nonce);
      if (caller) {
        const left = perCaller.get(caller)! - 1;
        if (left > 0) perCaller.set(caller, left);
        else perCaller.delete(caller);
      }
    }
  };
}
