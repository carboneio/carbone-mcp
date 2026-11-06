import { createHash, randomBytes } from 'node:crypto';
import { Sealer } from './sealer.js';
import type { ObjectStore } from './objectStore.js';

/**
 * Async renders (HTTP only, with MCP_TICKET_SECRET and a shared store): render_document with async: true gives
 * Carbone this server's WEBHOOK_PATH as its webhook, and the assistant a job ID. Carbone calls the webhook once, with
 * the renderId, when the document is ready (it never retries); the instance receiving it, any of them, records the
 * result in the shared store, where get_render_result finds it, from any instance too. Nothing else is shared.
 *
 * Three sealed values, each with its own key: the job ID the assistant holds (with its expiry and its caller), the
 * token Carbone sends back in a webhook header (so it is not in the URL), and the stored result (the store alone
 * reveals nothing: a renderId is itself a download right). Stored under a hash of the job, never the job itself.
 */

export const WEBHOOK_PATH = '/webhook';
/** The header Carbone sends the job token back in (forwarded from carbone-webhook-header-x-job-token). */
export const JOB_TOKEN_HEADER = 'x-job-token';
/** How long a job, and its result, are kept: the one-time download link itself lasts an hour too. */
export const JOB_TTL_SECONDS = 3600;
/** The largest webhook body read: Carbone posts a few hundred bytes. */
export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
/** How long a webhook body may take to arrive: Carbone itself gives up on the call after 16 s. */
export const WEBHOOK_BODY_TIMEOUT_MS = 20_000;
/** Carbone stops an async render after 10 minutes: past that (and a margin), a job still without a result failed. */
const RENDER_LIMIT_SECONDS = 11 * 60;
/** A Carbone renderId: a random part and the report name, both base64url, then the extension. */
const RENDER_ID = /^[\w-]{1,1000}\.[a-z0-9]{1,10}$/i;

interface JobRef { exp: number; jobId: string; caller: string; format?: string }
interface JobToken { exp: number; jobId: string }
/** Holds its job ID: a result copied over another job's object (by someone who can write to the store) is refused. */
interface JobResult { exp: number; jobId: string; renderId?: string; error?: string }

export type JobStatus =
  | { status: 'pending' }
  | { status: 'unknown' }
  | { status: 'done'; renderId: string; format?: string }
  | { status: 'failed'; error: string };

export interface Jobs {
  /** A new job for `caller` (callerIdFrom): the ID for the assistant, and the webhook URL and headers for Carbone. */
  start(caller: string, format?: string): { jobId: string; webhookUrl: string; webhookHeaders: Record<string, string> };
  /** Where a job stands, from the ID the assistant holds; unknown to any other caller. */
  status(jobId: string, caller: string): Promise<JobStatus>;
  /** Carbone's webhook call, the token checked before the body is read: the HTTP status to answer. */
  record(token: string | undefined, readBody: () => Promise<unknown>): Promise<number>;
}

export function createJobs(options: {
  secret: Buffer;
  publicUrl: string;
  store: ObjectStore;
  now?: () => number;
}): Jobs {
  const now = options.now ?? Date.now;
  const refs = new Sealer<JobRef>(options.secret, options.publicUrl, 'async render job', now);
  const tokens = new Sealer<JobToken>(options.secret, options.publicUrl, 'async render webhook', now);
  const results = new Sealer<JobResult>(options.secret, options.publicUrl, 'async render result', now);
  const webhookUrl = new URL(WEBHOOK_PATH, options.publicUrl).href;
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const objectKey = (jobId: string) => `jobs/${hash(jobId)}`;
  const nowSeconds = () => Math.floor(now() / 1000);

  return {
    start(caller, format) {
      const jobId = randomBytes(16).toString('hex');
      const exp = nowSeconds() + JOB_TTL_SECONDS;
      return {
        jobId: refs.seal({ exp, jobId, caller: hash(caller), ...(format && { format }) }),
        webhookUrl,
        webhookHeaders: { [JOB_TOKEN_HEADER]: tokens.seal({ exp, jobId }) },
      };
    },

    async status(jobRef, caller) {
      const ref = refs.open(jobRef);
      if (!ref || ref.caller !== hash(caller)) return { status: 'unknown' };
      const stored = await options.store.get(objectKey(ref.jobId));
      const opened = stored === undefined ? undefined : results.open(stored);
      const result = opened?.jobId === ref.jobId ? opened : undefined;
      if (!result) {
        // Carbone's one webhook call never came (the render failed to call back, or the call was lost).
        const startedAt = ref.exp - JOB_TTL_SECONDS;
        return nowSeconds() - startedAt > RENDER_LIMIT_SECONDS
          ? { status: 'failed', error: 'No result after 10 minutes.' }
          : { status: 'pending' };
      }
      return result.renderId
        ? { status: 'done', renderId: result.renderId, ...(ref.format && { format: ref.format }) }
        : { status: 'failed', error: result.error ?? 'The render failed.' };
    },

    async record(token, readBody) {
      const job = token === undefined ? undefined : tokens.open(token);
      if (!job) return 401;
      // Carbone posts its render response: { success: true, data: { renderId } }, or { success: false, error }.
      const response = ((await readBody()) ?? {}) as { success?: unknown; error?: unknown; data?: { renderId?: unknown } };
      const renderId = response.data?.renderId;
      const exp = nowSeconds() + JOB_TTL_SECONDS;
      const result: JobResult = response.success === true && typeof renderId === 'string' && RENDER_ID.test(renderId)
        ? { exp, jobId: job.jobId, renderId }
        : { exp, jobId: job.jobId, error: typeof response.error === 'string' ? response.error.slice(0, 500) : 'The render failed.' };
      // Written once: a replayed token cannot replace the result Carbone recorded. A store that cannot tell a missing
      // object (S3 answers 403 without the ListBucket right) still records it: Carbone calls only once.
      const key = objectKey(job.jobId);
      if (await options.store.get(key).catch(() => undefined) === undefined) await options.store.put(key, results.seal(result));
      return 200;
    },
  };
}
