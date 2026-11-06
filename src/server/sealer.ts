import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Sealed tokens: data the server hands out (upload tickets, async render jobs) or stores (render results), then reads
 * back, maybe on another instance. Sealed, any instance can open them, so no instance keeps any state and autoscaling
 * needs nothing shared but MCP_TICKET_SECRET.
 *
 * AES-256-GCM, so a token can be neither read nor altered: some hold a credential. The key is derived from the secret
 * with HKDF-SHA-512, never used as is, per purpose (a token sealed for one purpose never opens as another) and bound to
 * the server's public URL (two deployments sharing a secret, staging and prod, never accept each other's tokens).
 * AES-256 keeps about 128-bit security against a quantum computer (Grover), which is the post-quantum recommendation
 * for symmetric encryption. Format: `v1.<base64url(iv | ciphertext | tag)>`, the `v1` prefix being authenticated too.
 *
 * No key rotation: tokens live at most an hour, so changing the secret only refuses those issued just before (as
 * invalid, which tells the client to ask again), and no old secret lingers in the configuration.
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Bytes of entropy the secret needs: as many as the AES-256 key derived from it. */
const MIN_SECRET_BYTES = 32;

export class Sealer<T extends { exp: number }> {
  private readonly key: Buffer;

  /** `purpose`: what the tokens are for; `publicUrl`: the origin the server is reached at. Both bind the key. */
  constructor(secret: Buffer, publicUrl: string, purpose: string, private readonly now: () => number = Date.now) {
    this.key = Buffer.from(hkdfSync('sha512', secret, Buffer.alloc(0), `carbone-mcp ${purpose} ${VERSION} ${publicUrl}`, 32));
  }

  seal(payload: T): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(VERSION));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    return `${VERSION}.${Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64url')}`;
  }

  /** The payload, or undefined when the token is malformed, altered, sealed elsewhere or for another purpose, or expired. */
  open(token: string): T | undefined {
    const [version, blob, ...rest] = token.split('.');
    if (version !== VERSION || !blob || rest.length > 0) return undefined;
    const raw = Buffer.from(blob, 'base64url');
    if (raw.length <= IV_BYTES + TAG_BYTES) return undefined;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(VERSION));
      decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
      const plaintext = Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]);
      const payload = JSON.parse(plaintext.toString('utf8')) as T;
      return payload.exp * 1000 > this.now() ? payload : undefined;
    } catch {
      return undefined;
    }
  }
}

/** MCP_TICKET_SECRET: base64 (or base64url) of at least MIN_SECRET_BYTES random bytes. */
export function parseTicketSecret(value: string): Buffer {
  const secret = /^[A-Za-z0-9+/_-]+={0,2}$/.test(value) ? Buffer.from(value, 'base64') : Buffer.alloc(0);
  if (secret.length < MIN_SECRET_BYTES) {
    throw new Error(
      `Invalid MCP_TICKET_SECRET: it must be at least ${MIN_SECRET_BYTES} random bytes, base64-encoded. ` +
      'Generate one with: openssl rand -base64 32'
    );
  }
  return secret;
}
