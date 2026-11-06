import { z } from 'zod';
import type { IoModes } from './inputForms.js';

/**
 * Chat attachments passed by ChatGPT (OpenAI Apps SDK `_meta["openai/fileParams"]`).
 *
 * ChatGPT hands a file the user attached to the conversation only to a top-level input listed in the tool's
 * `_meta["openai/fileParams"]`, as `{ download_url, file_id, mime_type?, file_name? }`. Its Scan Tools step
 * and plugin submission reject a file schema that does not declare all four properties, or whose required list
 * is not exactly download_url and file_id. https://developers.openai.com/apps-sdk/reference
 *
 * Other clients ignore `_meta` and see an optional parameter that they leave empty. The field is offered over
 * HTTP only: ChatGPT reaches the server remotely, and a stdio client can pass a local path instead.
 * The server downloads `download_url` like any URL input (SSRF guard, size cap, timeout).
 */

/** The `_meta` key ChatGPT reads to know which top-level inputs take a chat attachment. */
export const OPENAI_FILE_PARAMS = 'openai/fileParams';

export interface ChatFile {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
}

/** Whether these I/O modes offer chat attachment fields (HTTP only, see above). */
export function acceptsChatAttachments(io: IoModes): boolean {
  return !io.allowLocalPath;
}

/**
 * The attachment field. `alternativeTo` names the string input it stands in for (template, file), and
 * `exclusiveWith` every input it cannot be combined with.
 */
export function chatFileSchema(alternativeTo: string, exclusiveWith: string = alternativeTo) {
  return z
    .object({
      download_url: z.url({ protocol: /^https$/ }),
      file_id: z.string(),
      mime_type: z.string().optional(),
      file_name: z.string().optional(),
    })
    .optional()
    .describe(
      'A file the user attached to the conversation, filled in by ChatGPT. Other clients leave it empty and pass ' +
      `${alternativeTo} instead. Mutually exclusive with ${exclusiveWith}.`
    );
}

/** The tool `_meta` declaring `field` as a chat attachment, or nothing when the transport does not offer one. */
export function chatFileMeta(io: IoModes, field: string): { _meta?: Record<string, unknown> } {
  return acceptsChatAttachments(io) ? { _meta: { [OPENAI_FILE_PARAMS]: [field] } } : {};
}

/**
 * The file input to resolve: the string form, or else the attachment's download URL. Both given is an error, so
 * neither is silently ignored.
 */
export function pickFile(value: string | undefined, attached: ChatFile | undefined, names: [string, string]): { source?: string; error?: string } {
  if (value != null && attached != null) return { error: `Provide either ${names[0]} or ${names[1]}, not both.` };
  return { source: value ?? attached?.download_url };
}
