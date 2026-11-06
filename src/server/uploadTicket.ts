import { Sealer } from './sealer.js';

/**
 * Upload tickets: what an upload URL carries, sealed (src/server/sealer.ts) so that any server instance can open it.
 *
 * upload_template with requestUploadUrl issues a ticket, and the client then sends the file to /upload with it, maybe
 * to another instance: the ticket holds everything that request needs (the caller's credential, the file's size and
 * SHA-256, the template fields), so no instance keeps any state.
 */

/** Where upload URLs point, on the server's public origin. */
export const UPLOAD_PATH = '/upload';

/** What the server uses to call the Carbone API for the upload. */
export type UploadCredential =
  /** API-key mode: the caller's Carbone API key. */
  | { apiKey: string }
  /** OAuth mode: the caller's own access token, exchanged again when the file arrives (never sent to Carbone). */
  | { subjectToken: string }
  /** A self-hosted server's own CARBONE_API_KEY, or an on-premise Carbone without authentication. */
  | { serverKey: true };

/** The upload_template fields the template is created with. */
export interface UploadFields {
  versioning: boolean;
  id?: string;
  name?: string;
  category?: string;
  comment?: string;
  tags?: string[];
  deployedAt?: number;
  expireAt?: number;
}

export interface UploadTicket {
  /** Expiry, UTC Unix seconds. */
  exp: number;
  /** Random. Sent as Carbone's `salt` without versioning, so a replay of this ticket stores the same version again. */
  nonce: string;
  credential: UploadCredential;
  /** A hash of who asked for it (callerIdFrom), for the per-caller limit; '' for the server's own key. */
  caller: string;
  /** The file the ticket accepts, and only that file. */
  size: number;
  sha256: string;
  fields: UploadFields;
}

export type UploadTicketSealer = Sealer<UploadTicket>;

/** The sealer of upload tickets: its own key, derived from MCP_TICKET_SECRET. */
export function uploadSealer(secret: Buffer, publicUrl: string, now?: () => number): UploadTicketSealer {
  return new Sealer<UploadTicket>(secret, publicUrl, 'upload ticket', now);
}
