import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Where async renders keep their results: a minimal S3-compatible object store client (PUT and GET of small text
 * objects, signed with AWS Signature V4, https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html,
 * on node:crypto and fetch only), or a directory. Any S3-compatible service works (AWS S3, MinIO, Cloudflare R2,
 * ...), with path-style URLs (`<endpoint>/<bucket>/<key>`), which every one of them accepts.
 * Keys are path-safe (the callers use hex).
 */

export interface ObjectStoreConfig {
  /** The service origin, e.g. "https://s3.us-east-1.amazonaws.com". */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface ObjectStore {
  put(key: string, body: string): Promise<void>;
  /** The object, or undefined when there is none. */
  get(key: string): Promise<string | undefined>;
}

/** A store call gives up after this delay. */
const STORE_TIMEOUT_MS = 10_000;

const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/**
 * The Authorization header of a request, per SigV4. `headers` are the headers to sign, with lowercase names: host,
 * x-amz-date, and x-amz-content-sha256 (the hex SHA-256 of the body) included. The URL has no query string here.
 */
export function signV4(
  request: { method: string; path: string; headers: Record<string, string> },
  credentials: { accessKeyId: string; secretAccessKey: string; region: string }
): string {
  const amzDate = request.headers['x-amz-date']!;
  const day = amzDate.slice(0, 8);
  const names = Object.keys(request.headers).sort();
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    request.method,
    request.path,
    '', // no query string
    ...names.map((name) => `${name}:${request.headers[name]!.trim()}`),
    '',
    signedHeaders,
    request.headers['x-amz-content-sha256'],
  ].join('\n');
  const scope = `${day}/${credentials.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), credentials.region), 's3'), 'aws4_request');
  const signature = hmac(signingKey, stringToSign).toString('hex');
  return `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

export function createObjectStore(config: ObjectStoreConfig, options: { now?: () => number } = {}): ObjectStore {
  const now = options.now ?? Date.now;
  const endpoint = new URL(config.endpoint);

  async function request(method: 'GET' | 'PUT', key: string, body?: string): Promise<Response> {
    const path = `/${config.bucket}/${key}`;
    const headers: Record<string, string> = {
      host: endpoint.host,
      'x-amz-content-sha256': sha256Hex(body ?? ''),
      'x-amz-date': new Date(now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''),
    };
    const authorization = signV4({ method, path, headers }, config);
    const { host: _host, ...sent } = headers; // fetch sets Host itself
    return fetch(new URL(path, endpoint), {
      method,
      headers: { ...sent, authorization, ...(body !== undefined && { 'content-type': 'text/plain' }) },
      body,
      // A redirect (another region, a misconfigured endpoint) is an error, never a request resent elsewhere.
      redirect: 'error',
      signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
    });
  }

  return {
    async put(key, body) {
      const response = await request('PUT', key, body);
      await response.body?.cancel();
      if (!response.ok) throw new Error(`Object storage PUT failed: HTTP ${response.status}`);
    },
    async get(key) {
      const response = await request('GET', key);
      if (response.ok) return response.text();
      await response.body?.cancel();
      if (response.status === 404) return undefined;
      throw new Error(`Object storage GET failed: HTTP ${response.status}`);
    },
  };
}

/**
 * At most this many directory calls at once, the others waiting their turn, each given up after STORE_TIMEOUT_MS:
 * a hung network volume then holds only these threads of libuv's pool (4 by default), never those DNS lookups and
 * other files need.
 */
const MAX_DIR_CALLS = 2;

/**
 * The same store on a directory: every instance must see the same one (a single instance, or a volume they all
 * mount). Each object is written to a temporary file then renamed, so a reader never sees half of one. Nothing
 * expires files on its own: a write deletes those older than `maxAgeMs` in its folder, at most once per `maxAgeMs`.
 */
export function createDirStore(dir: string, options: { maxAgeMs: number; now?: () => number; timeoutMs?: number }): ObjectStore {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? STORE_TIMEOUT_MS;
  let nextSweep = 0;
  let calls = 0;
  const queue: Array<() => void> = [];
  const pathOf = (key: string) => {
    if (!/^[\w-]+(\/[\w-]+)*$/.test(key)) throw new Error(`Invalid object key "${key}"`);
    return join(dir, key);
  };
  const isMissing = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT';

  /**
   * One call to the directory, waiting for a free slot first, both within timeoutMs. The slot is held until the call
   * really ends (one that timed out still holds its thread), then handed to the next in line.
   */
  async function limited<T>(call: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    let turn: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const waiting = turn && queue.indexOf(turn);
        if (waiting !== undefined && waiting >= 0) queue.splice(waiting, 1);
        reject(new Error(turn && waiting !== undefined && waiting >= 0
          ? 'Job directory busy: earlier calls have not returned'
          : `Job directory call timed out after ${timeoutMs} ms`));
      }, timeoutMs);
    });
    try {
      if (calls < MAX_DIR_CALLS) calls++;
      else await Promise.race([new Promise<void>((resolve) => queue.push(turn = resolve)), timeout]);
      const running = call().finally(() => {
        const next = queue.shift();
        if (next) next(); // the slot passes to the next call
        else calls--;
      });
      return await Promise.race([running, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function sweep(folder: string): Promise<void> {
    const oldest = now() - options.maxAgeMs;
    for (const name of await limited(() => readdir(folder))) {
      const path = join(folder, name);
      // Another instance may sweep the same folder: a file already gone is fine; anything else stops the sweep.
      const file = await limited(() => stat(path)).catch((err) => { if (isMissing(err)) return undefined; throw err; });
      if (file?.isFile() && file.mtimeMs < oldest) {
        await limited(() => unlink(path)).catch((err) => { if (!isMissing(err)) throw err; });
      }
    }
  }

  return {
    async put(key, body) {
      const path = pathOf(key);
      const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
      await limited(async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temporary, body, { mode: 0o600 });
        await rename(temporary, path);
      });
      if (now() >= nextSweep) {
        nextSweep = now() + options.maxAgeMs;
        void sweep(dirname(path)).catch(() => {});
      }
    },
    async get(key) {
      const path = pathOf(key);
      try {
        return await limited(() => readFile(path, 'utf8'));
      } catch (err) {
        if (isMissing(err)) return undefined;
        throw err;
      }
    },
  };
}
