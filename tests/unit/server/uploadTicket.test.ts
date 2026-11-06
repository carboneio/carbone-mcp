import { describe, test, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { uploadSealer, type UploadTicket } from '../../../src/server/uploadTicket.js';
import { Sealer, parseTicketSecret } from '../../../src/server/sealer.js';

const SECRET = Buffer.alloc(32, 1);
const OTHER = Buffer.alloc(32, 2);
const NOW = 1_800_000_000_000;

const ticket = (overrides: Partial<UploadTicket> = {}): UploadTicket => ({
  exp: NOW / 1000 + 600,
  nonce: 'n'.repeat(32),
  credential: { apiKey: 'key-1' },
  caller: 'caller-hash',
  size: 3,
  sha256: 'a'.repeat(64),
  fields: { versioning: true, name: 'Invoice' },
  ...overrides,
});

describe('Sealer (upload tickets)', () => {
  const URL_A = 'https://mcp.example.test';
  const sealer = uploadSealer(SECRET, URL_A, () => NOW);

  test('a sealed ticket opens to the same content, and hides it', () => {
    const token = sealer.seal(ticket());
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(token).not.toContain('key-1');
    expect(Buffer.from(token.split('.')[1]!, 'base64url').toString('latin1')).not.toContain('key-1');
    expect(sealer.open(token)).toEqual(ticket());
  });

  test('two seals of the same ticket differ (fresh IV)', () => {
    expect(sealer.seal(ticket())).not.toBe(sealer.seal(ticket()));
  });

  test('an expired ticket is refused', () => {
    const token = sealer.seal(ticket({ exp: NOW / 1000 }));
    expect(sealer.open(token)).toBeUndefined();
  });

  test('any alteration, another secret, or garbage is refused', () => {
    const token = sealer.seal(ticket());
    const [v, blob] = token.split('.') as [string, string];
    const raw = Buffer.from(blob, 'base64url');
    raw[20] = raw[20]! ^ 1;
    expect(sealer.open(`${v}.${raw.toString('base64url')}`)).toBeUndefined();
    expect(uploadSealer(OTHER, URL_A, () => NOW).open(token)).toBeUndefined();
    for (const bad of ['', 'v1', `v2.${blob}`, `${v}.${blob}.x`, `${v}.AAAA`]) {
      expect(sealer.open(bad), bad).toBeUndefined();
    }
  });

  test('bound to its purpose: the same secret sealing another kind of token refuses it', () => {
    const jobs = new Sealer<UploadTicket>(SECRET, URL_A, 'async render job', () => NOW);
    expect(jobs.open(sealer.seal(ticket()))).toBeUndefined();
  });

  test('bound to the deployment: the same secret behind another public URL refuses the ticket', () => {
    const staging = uploadSealer(SECRET, 'https://staging.example.test', () => NOW);
    expect(staging.open(sealer.seal(ticket()))).toBeUndefined();
  });
});

describe('parseTicketSecret', () => {
  test('accepts 32 or more random bytes in base64 or base64url', () => {
    const bytes = randomBytes(32);
    expect(parseTicketSecret(bytes.toString('base64'))).toEqual(bytes);
    expect(parseTicketSecret(bytes.toString('base64url'))).toEqual(bytes);
  });

  test('refuses a short or non-base64 secret, and says how to make one', () => {
    for (const bad of [randomBytes(16).toString('base64'), 'not base64 at all!', 'x']) {
      expect(() => parseTicketSecret(bad)).toThrow(/MCP_TICKET_SECRET.*openssl rand -base64 32/);
    }
  });
});
