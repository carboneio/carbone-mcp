import { describe, test, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uploadSealer, type UploadTicket } from '../../../src/server/uploadTicket.js';
import {
  createUploadIssuer, createUploadRoute, uploadCallerFrom, uploadFormFields, MAX_CONCURRENT_UPLOADS, MAX_CONCURRENT_UPLOADS_PER_CALLER,
  MIN_UPLOAD_RATE, UPLOAD_TICKET_HEADER,
} from '../../../src/server/upload.js';
import type { CarboneClient } from '../../../src/carbone/client.js';
import { CarboneAuthError, CarboneError, CarboneValidationError, CarboneConnectionError } from '../../../src/carbone/errors.js';
import { AuthorizationServerUnavailableError } from '../../../src/carbone/tokenExchange.js';

const FILE = Buffer.from('PK\u0003\u0004 a template');
const SHA = createHash('sha256').update(FILE).digest('hex');
const sealer = uploadSealer(Buffer.alloc(32, 9), 'https://mcp.example.test');

const ticketFor = (overrides: Partial<UploadTicket> = {}): string => sealer.seal({
  exp: Math.floor(Date.now() / 1000) + 600,
  nonce: randomBytes(16).toString('hex'),
  credential: { apiKey: 'caller-key' },
  caller: 'caller-hash',
  size: FILE.length,
  sha256: SHA,
  fields: { versioning: true, name: 'Invoice' },
  ...overrides,
});

/** The fake Carbone client: reads the streamed content as the real one does, then answers (or fails). */
let behaviour: (content: Buffer) => Promise<unknown>;
const uploadTemplateStream = vi.fn(async (params: { content: AsyncIterable<Uint8Array> }) => {
  const chunks: Buffer[] = [];
  for await (const chunk of params.content) chunks.push(Buffer.from(chunk));
  return behaviour(Buffer.concat(chunks));
});
const client = { uploadTemplateStream } as unknown as CarboneClient;
const exchange = vi.fn(async (subject: string) => `exchanged-for-${subject}`);

let server: Server;
let base: string;

beforeAll(async () => {
  const route = createUploadRoute({ sealer, client, maxBytes: 1024, exchange });
  server = createServer((req, res) => void route(req, res));
  // As src/server/http.ts does: the route itself answers "100 Continue", once the upload URL is checked.
  server.on('checkContinue', (req, res) => void route(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  uploadTemplateStream.mockClear();
  exchange.mockClear();
  behaviour = async () => ({ id: '1530905183164918624', versionId: 'ab'.repeat(32), type: 'docx', size: FILE.length, deployedAt: 0 });
});

const send = (token: string | undefined, body: Buffer = FILE) => fetch(`${base}/upload`, {
  method: 'POST',
  headers: { ...(token && { [UPLOAD_TICKET_HEADER]: token }), 'Content-Type': 'application/octet-stream' },
  body: new Uint8Array(body),
});

describe('upload route', () => {
  test('stores the file with the caller key, and answers the upload_template result as JSON', async () => {
    const res = await send(ticketFor());
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json).toMatchObject({ id: '1530905183164918624', name: 'Invoice', type: 'docx' });
    expect(json['message']).toMatch(/^Template uploaded successfully!/);
    expect(uploadTemplateStream).toHaveBeenCalledWith(
      expect.objectContaining({ size: FILE.length, fields: [['versioning', 'true'], ['name', 'Invoice']] }),
      expect.objectContaining({ apiKey: 'caller-key' })
    );
  });

  test('OAuth: the sealed caller token is exchanged when the file arrives', async () => {
    await send(ticketFor({ credential: { subjectToken: 'opaque' } }));
    expect(exchange).toHaveBeenCalledWith('opaque', expect.any(AbortSignal));
    expect(uploadTemplateStream).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apiKey: 'exchanged-for-opaque' }));
  });

  test('server key: no key is passed, the client uses its own', async () => {
    await send(ticketFor({ credential: { serverKey: true } }));
    expect(uploadTemplateStream).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apiKey: undefined }));
  });

  test('refused before reading the body: no ticket, a bad one, an expired one, another method', async () => {
    const missing = await send(undefined);
    expect([missing.status, (await missing.json() as { error: string }).error]).toEqual([401, expect.stringMatching(/^Missing X-Upload-Token/)]);
    for (const token of ['v1.nope', ticketFor({ exp: Math.floor(Date.now() / 1000) - 1 })]) {
      const res = await send(token);
      expect([res.status, (await res.json() as { error: string }).error])
        .toEqual([401, expect.stringMatching(/invalid or has expired: call upload_template with requestUploadUrl again/)]);
    }
    for (const method of ['GET', 'PUT']) {
      const res = await fetch(`${base}/upload`, { method, ...(method === 'PUT' && { body: 'x' }) });
      expect([res.status, res.headers.get('allow')]).toEqual([405, 'POST, OPTIONS']);
    }
    expect(uploadTemplateStream).not.toHaveBeenCalled();
  });

  test('a body whose length is not the ticket size is refused before Carbone is called', async () => {
    const res = await send(ticketFor(), Buffer.concat([FILE, Buffer.from('x')]));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/issued for a \d+-byte file: nothing was stored/);
    expect(uploadTemplateStream).not.toHaveBeenCalled();
  });

  test('a ticket over the server limit is refused', async () => {
    const big = Buffer.alloc(2048);
    const res = await send(ticketFor({ size: big.length }), big);
    expect(res.status).toBe(413);
  });

  test('a body without Content-Length (chunked) is refused with 411', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}/upload`, { method: 'POST', headers: { [UPLOAD_TICKET_HEADER]: ticketFor() } }, (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.on('error', reject);
      req.write(FILE); // no Content-Length: Node sends it chunked
      req.end();
    });
    expect(status).toBe(411);
  });

  test('a refused file is reported from the recorded reason, however the client wraps the error', async () => {
    behaviour = async () => { throw new CarboneConnectionError('Could not reach the Carbone API: aborted.'); };
    const res = await send(ticketFor({ sha256: '0'.repeat(64) }));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/does not have the SHA-256 the upload URL was issued for: nothing was stored/);
  });

  test('Carbone and authorization errors map to HTTP statuses', async () => {
    behaviour = async () => { throw new CarboneError('Template too large', 413, undefined, 'w119'); };
    expect((await send(ticketFor())).status).toBe(413);
    behaviour = async () => { throw new CarboneValidationError('bad field'); };
    expect((await send(ticketFor())).status).toBe(400);
    behaviour = async () => { throw new CarboneAuthError('refused'); };
    expect((await send(ticketFor())).status).toBe(401);
    behaviour = async () => { throw new CarboneConnectionError('down'); };
    expect((await send(ticketFor())).status).toBe(502);
    exchange.mockRejectedValueOnce(new AuthorizationServerUnavailableError('down', 7));
    const unavailable = await send(ticketFor({ credential: { subjectToken: 'opaque' } }));
    expect([unavailable.status, unavailable.headers.get('retry-after')]).toEqual([503, '7']);
  });

  test('one ticket uploads one file at a time: a second request with it is refused while the first runs', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    behaviour = async () => { await held; return { id: '1', versionId: 'v' }; };
    const token = ticketFor();
    const first = send(token);
    await vi.waitFor(() => expect(uploadTemplateStream).toHaveBeenCalledTimes(1));
    expect((await send(token)).status).toBe(409);
    release();
    expect((await first).status).toBe(200);
  });

  test('once the file has arrived, a slow store at Carbone is waited for (no idle cut-off)', async () => {
    const windowMs = MIN_UPLOAD_RATE.windowMs;
    MIN_UPLOAD_RATE.windowMs = 50;
    try {
      behaviour = async () => { await new Promise((r) => setTimeout(r, 200)); return { id: '1', versionId: 'v' }; };
      expect((await send(ticketFor())).status).toBe(200);
    } finally {
      MIN_UPLOAD_RATE.windowMs = windowMs;
    }
  });

  test('an upload whose first bytes do not come is dropped, and frees its slot', async () => {
    const startMs = MIN_UPLOAD_RATE.startMs;
    MIN_UPLOAD_RATE.startMs = 100;
    try {
      const outcome = await new Promise<string>((resolve) => {
        const req = request(`${base}/upload`, {
          method: 'POST',
          headers: { [UPLOAD_TICKET_HEADER]: ticketFor(), 'Content-Length': String(FILE.length) },
        }, (res) => resolve(`status ${res.statusCode}`));
        req.on('error', (err) => resolve((err as NodeJS.ErrnoException).code ?? err.message));
        req.flushHeaders(); // and no body
      });
      expect(outcome).toMatch(/ECONNRESET|socket hang up/);
      expect((await send(ticketFor())).status).toBe(200);
    } finally {
      MIN_UPLOAD_RATE.startMs = startMs;
    }
  });

  test('an upload arriving slower than the minimum rate is dropped, and frees its slot', async () => {
    const windowMs = MIN_UPLOAD_RATE.windowMs;
    MIN_UPLOAD_RATE.windowMs = 100;
    try {
      const outcome = await new Promise<string>((resolve) => {
        const req = request(`${base}/upload`, {
          method: 'POST',
          headers: { [UPLOAD_TICKET_HEADER]: ticketFor(), 'Content-Length': String(FILE.length) },
        }, (res) => resolve(`status ${res.statusCode}`));
        req.on('error', (err) => resolve((err as NodeJS.ErrnoException).code ?? err.message));
        req.write(FILE.subarray(0, 2)); // then nothing more
      });
      expect(outcome).toMatch(/ECONNRESET|socket hang up/);
      expect((await send(ticketFor())).status).toBe(200);
    } finally {
      MIN_UPLOAD_RATE.windowMs = windowMs;
    }
  });

  test(`more than ${MAX_CONCURRENT_UPLOADS} uploads at once (from different callers): the next one is told to retry`, async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    behaviour = async () => { await held; return { id: '1', versionId: 'v' }; };
    const running = Array.from({ length: MAX_CONCURRENT_UPLOADS }, (_, i) => send(ticketFor({ caller: `caller-${i}` })));
    await vi.waitFor(() => expect(uploadTemplateStream).toHaveBeenCalledTimes(MAX_CONCURRENT_UPLOADS));
    const extra = await send(ticketFor({ caller: 'another-caller' }));
    expect([extra.status, extra.headers.get('retry-after')]).toEqual([503, '5']);
    release();
    expect((await Promise.all(running)).map((r) => r.status)).toEqual(Array(MAX_CONCURRENT_UPLOADS).fill(200));
  });

  test(`one caller: ${MAX_CONCURRENT_UPLOADS_PER_CALLER} uploads at once, then retry, whatever token each came with; the server key is not limited per caller`, async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    behaviour = async () => { await held; return { id: '1', versionId: 'v' }; };
    const mine = Array.from({ length: MAX_CONCURRENT_UPLOADS_PER_CALLER }, (_, i) => send(ticketFor({ credential: { subjectToken: `token-${i}` } })));
    const shared = Array.from({ length: MAX_CONCURRENT_UPLOADS_PER_CALLER + 1 }, () => send(ticketFor({ credential: { serverKey: true }, caller: '' })));
    await vi.waitFor(() => expect(uploadTemplateStream).toHaveBeenCalledTimes(2 * MAX_CONCURRENT_UPLOADS_PER_CALLER + 1));
    expect((await send(ticketFor({ credential: { subjectToken: 'yet-another-token' } }))).status).toBe(503);
    release();
    expect((await Promise.all([...mine, ...shared])).every((r) => r.status === 200)).toBe(true);
    // The count is given back: the caller can upload again.
    expect((await send(ticketFor())).status).toBe(200);
  });

  test('a client sending "Expect: 100-continue" gets it once the upload URL is checked', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}/upload`, {
        method: 'POST',
        headers: { [UPLOAD_TICKET_HEADER]: ticketFor(), 'Content-Length': String(FILE.length), Expect: '100-continue' },
      }, (res) => { res.resume(); resolve(res.statusCode!); });
      req.on('continue', () => req.end(FILE));
      req.on('error', reject);
    });
    expect(status).toBe(200);
  });
});

describe('uploadFormFields', () => {
  const base = { exp: 0, nonce: 'n1', credential: { serverKey: true as const }, size: 1, sha256: SHA };

  test('versioning: versioning (and id) first, then the metadata', () => {
    expect(uploadFormFields({ ...base, fields: { versioning: true, id: '42', name: 'N', category: 'c', comment: 'm', tags: ['a', 'b'], deployedAt: 1, expireAt: 2 } }))
      .toEqual([['versioning', 'true'], ['id', '42'], ['name', 'N'], ['category', 'c'], ['comment', 'm'], ['tags', '["a","b"]'], ['deployedAt', '1'], ['expireAt', '2']]);
  });

  test('without versioning: the ticket nonce as salt, never an unsalted upload', () => {
    expect(uploadFormFields({ ...base, fields: { versioning: false } })).toEqual([['salt', 'n1']]);
  });
});

describe('createUploadIssuer / uploadCallerFrom', () => {
  const issuer = createUploadIssuer({ sealer, publicUrl: 'https://mcp.example.test', now: () => 1_800_000_000_000 });

  test('issues a URL on the public origin, valid 10 minutes, with the ticket in a header', () => {
    const issued = issuer.issue({ size: 3, sha256: 'A'.repeat(64), fields: { versioning: true } }, { id: 'key:k', credential: { apiKey: 'k' } });
    expect(issued).toMatchObject({ uploadUrl: 'https://mcp.example.test/upload', expiresAt: 1_800_000_600 });
    const opened = sealer.open(issued.headers[UPLOAD_TICKET_HEADER]!);
    expect(opened).toMatchObject({ exp: 1_800_000_600, credential: { apiKey: 'k' }, size: 3, sha256: 'a'.repeat(64) });
    // Who asked, hashed: the per-caller limit counts it, not the credential.
    expect(opened!.caller).toBe(createHash('sha256').update('key:k').digest('hex'));
    expect(sealer.open(issuer.issue({ size: 3, sha256: SHA, fields: { versioning: true } }, { id: '', credential: { serverKey: true } }).headers[UPLOAD_TICKET_HEADER]!)!.caller).toBe('');
  });

  test('never outlives the caller sign-in', () => {
    const issued = issuer.issue({ size: 3, sha256: SHA, fields: { versioning: true } }, { id: 'sub:u', credential: { subjectToken: 't' }, expiresAt: 1_800_000_100 });
    expect(issued.expiresAt).toBe(1_800_000_100);
  });

  test('the caller of an MCP request: OAuth token through a function, API key, or the server key', () => {
    expect(uploadCallerFrom({ http: { authInfo: { token: 'jwt', expiresAt: 5, extra: { sub: 'user-1', uploadSubject: () => 'opaque' } } } }))
      .toEqual({ id: 'sub:user-1', credential: { subjectToken: 'opaque' }, expiresAt: 5 });
    expect(uploadCallerFrom({ http: { authInfo: { token: 'api-key' } } })).toEqual({ id: 'key:api-key', credential: { apiKey: 'api-key' } });
    expect(uploadCallerFrom({})).toEqual({ id: '', credential: { serverKey: true } });
  });
});
