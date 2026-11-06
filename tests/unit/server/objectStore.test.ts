import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { closeSync, openSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDirStore, createObjectStore, signV4 } from '../../../src/server/objectStore.js';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('signV4', () => {
  test('reproduces the AWS documentation example (GET Object, header-based authentication)', () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html, "Example: GET Object"
    const authorization = signV4({
      method: 'GET',
      path: '/test.txt',
      headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256, 'x-amz-date': '20130524T000000Z' },
    }, { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' });
    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
      'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    );
  });
});

describe('createObjectStore', () => {
  const objects = new Map<string, string>();
  const requests: Array<{ method: string; url: string; headers: IncomingMessage['headers'] }> = [];
  let failNext = 0;
  let server: Server;
  let endpoint: string;

  beforeAll(async () => {
    // A fake S3: path-style objects in memory, and the request kept to check how it was signed.
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        requests.push({ method: req.method!, url: req.url!, headers: req.headers });
        if (req.url!.endsWith('/moved')) {
          res.writeHead(307, { Location: '/elsewhere' }).end();
        } else if (failNext) {
          failNext--;
          res.writeHead(500).end('<Error/>');
        } else if (req.method === 'PUT') {
          objects.set(req.url!, Buffer.concat(chunks).toString());
          res.writeHead(200).end();
        } else if (objects.has(req.url!)) {
          res.writeHead(200).end(objects.get(req.url!));
        } else {
          res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const store = () => createObjectStore(
    { endpoint, region: 'eu-west-1', bucket: 'mcp-jobs', accessKeyId: 'AK', secretAccessKey: 'SK' },
    { now: () => Date.UTC(2026, 10, 5, 12, 0, 0) }
  );

  test('PUT then GET a text object, path-style, every request signed', async () => {
    await store().put('jobs/abc', 'sealed-value');
    expect(await store().get('jobs/abc')).toBe('sealed-value');
    const [put, get] = requests.slice(-2);
    expect([put!.method, put!.url, get!.method, get!.url]).toEqual(['PUT', '/mcp-jobs/jobs/abc', 'GET', '/mcp-jobs/jobs/abc']);
    expect(put!.headers['x-amz-date']).toBe('20261105T120000Z');
    expect(put!.headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(get!.headers['x-amz-content-sha256']).toBe(EMPTY_SHA256);
    expect(put!.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AK\/20261105\/eu-west-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
    );
  });

  test('a missing object is undefined; any other failure throws without the response body', async () => {
    expect(await store().get('jobs/none')).toBeUndefined();
    failNext = 1;
    await expect(store().get('jobs/abc')).rejects.toThrow(/^Object storage GET failed: HTTP 500$/);
    failNext = 1;
    await expect(store().put('jobs/abc', 'x')).rejects.toThrow(/^Object storage PUT failed: HTTP 500$/);
    // A redirect is never followed: the request is not resent elsewhere.
    const before = requests.length;
    await expect(store().put('jobs/moved', 'x')).rejects.toThrow();
    expect(requests.slice(before).map((r) => r.url)).toEqual(['/mcp-jobs/jobs/moved']);
  });
});

describe('createDirStore', () => {
  let dir: string;
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'mcp-jobs-')); });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  test('PUT then GET, owner-only files, no temporary file left; a missing object is undefined', async () => {
    const store = createDirStore(dir, { maxAgeMs: 3_600_000 });
    await store.put('jobs/abc', 'sealed-value');
    await store.put('jobs/abc', 'replaced');
    expect(await store.get('jobs/abc')).toBe('replaced');
    expect(await store.get('jobs/none')).toBeUndefined();
    expect(await readdir(join(dir, 'jobs'))).toEqual(['abc']);
    expect((await stat(join(dir, 'jobs/abc'))).mode & 0o777).toBe(0o600);
  });

  test('more calls at once than the limit wait their turn', async () => {
    const store = createDirStore(dir, { maxAgeMs: 3_600_000 });
    await Promise.all(Array.from({ length: 8 }, (_, i) => store.put(`jobs/queued${i}`, `v${i}`)));
    expect(await Promise.all(Array.from({ length: 8 }, (_, i) => store.get(`jobs/queued${i}`)))).toEqual(Array.from({ length: 8 }, (_, i) => `v${i}`));
  });

  test('refuses a key that could leave the directory', async () => {
    const store = createDirStore(dir, { maxAgeMs: 3_600_000 });
    await expect(store.put('../escape', 'x')).rejects.toThrow(/Invalid object key/);
    await expect(store.get('jobs/../../etc/passwd')).rejects.toThrow(/Invalid object key/);
  });

  test('a write deletes the files older than maxAgeMs, at most once per maxAgeMs', async () => {
    const clock = { now: Date.now() };
    const store = createDirStore(dir, { maxAgeMs: 60_000, now: () => clock.now });
    // A file left by an earlier run, two minutes old, in the folder a write goes to.
    const aged = async (name: string) => {
      await mkdir(join(dir, 'sweep'), { recursive: true });
      await writeFile(join(dir, 'sweep', name), 'old');
      const when = (clock.now - 120_000) / 1000;
      await utimes(join(dir, 'sweep', name), when, when);
    };
    await aged('first');
    await store.put('sweep/a', 'kept');
    await expect.poll(() => store.get('sweep/first')).toBeUndefined();
    await aged('second');
    await store.put('sweep/b', 'kept'); // within maxAgeMs of the last sweep: none
    expect(await store.get('sweep/second')).toBe('old');
    clock.now += 60_000;
    await store.put('sweep/c', 'kept');
    await expect.poll(() => store.get('sweep/second')).toBeUndefined();
    expect(await store.get('sweep/a')).toBe('kept');
  });

  // A FIFO with no writer blocks its reader, as a hung network volume would.
  test.skipIf(process.platform === 'win32')('a hung directory: calls time out, and at most two are ever in flight', async () => {
    const hung = join(dir, 'jobs', 'hung');
    execFileSync('mkfifo', [hung]);
    const store = createDirStore(dir, { maxAgeMs: 3_600_000, timeoutMs: 100 });
    try {
      await expect(store.get('jobs/hung')).rejects.toThrow(/timed out after 100 ms/);
      await expect(store.get('jobs/hung')).rejects.toThrow(/timed out/);
      // Both reads still hold their thread: the next calls wait for a slot, then give up, never touching the disk.
      await expect(store.get('jobs/abc')).rejects.toThrow(/busy/);
      await expect(store.put('jobs/other', 'x')).rejects.toThrow(/busy/);
    } finally {
      closeSync(openSync(hung, 'w')); // the hung reads end
    }
    await expect.poll(() => store.get('jobs/abc').catch(() => 'busy')).toBe('replaced');
    await rm(hung);
  });
});
