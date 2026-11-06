/**
 * Transport-dependent wording for caller-supplied inputs and outputs.
 *
 * A local filesystem path only means something in stdio, where the server runs as the caller on the
 * caller's machine. Over HTTP the same path would resolve on the SERVER's disk, so `resolveFileInput`
 * refuses it and `outputPath` is rejected (see `FileContext.allowFileInput` / `allowFileOutput`, and the
 * arbitrary-file-read fix in 1.5.0).
 *
 * The schema descriptions are what the model plans against, so they have to agree with what the server
 * will actually accept — advertising "local file path" on an HTTP deployment invites a call that can only
 * ever fail. These helpers keep both transports' wording in one place so the two cannot drift.
 */

export interface IoModes {
  /** Local filesystem paths may be READ (stdio only). */
  allowLocalPath: boolean;
  /** Generated documents may be WRITTEN to a local path (stdio only). */
  allowFileOutput: boolean;
  /** upload_template may issue an upload URL (HTTP with MCP_TICKET_SECRET). */
  allowUploadUrl?: boolean;
  /** render_document may run async with this server's own webhook (HTTP with MCP_TICKET_SECRET and an object store). */
  allowAsync?: boolean;
}

/** Wording used for the exported default schemas and anywhere a transport is not yet known. */
export const STDIO_IO: IoModes = { allowLocalPath: true, allowFileOutput: true };

/**
 * `{ [key]: schema }` when `offered`, `{}` otherwise: a parameter only some transports have. Typed as always present,
 * so the inferred tool arguments keep its type; a call where it is not offered simply never carries it.
 */
export function fieldIf<K extends string, S>(offered: boolean, key: K, schema: S): Record<K, S> {
  return (offered ? { [key]: schema } : {}) as Record<K, S>;
}

/** The accepted forms of a file/template parameter. */
export function inputForms(io: IoModes): string {
  return io.allowLocalPath
    ? 'An absolute local path ("/Users/me/report.docx", "~/report.docx"; a bare name like "report.docx" is read as ' +
      'base64), an HTTPS URL, or the file as base64. '
    : 'An HTTPS URL or the file as base64 (local paths are refused over HTTP). ';
}

/** A valid file value for examples: an absolute local path in stdio, an HTTPS URL over HTTP. */
export function exampleFile(name: string, io: IoModes): string {
  return io.allowLocalPath ? `/Users/me/${name}` : `https://example.com/${name}`;
}

/** Short form of the same idea, for prose that lists the accepted forms inline. */
export function inputFormsShort(io: IoModes): string {
  return io.allowLocalPath ? 'local path, HTTPS URL or base64' : 'HTTPS URL or base64';
}

/** The "or a reference to a JSON file" forms shared by the JSON params. */
export function jsonRefForms(io: IoModes): string {
  return io.allowLocalPath ? 'local path, HTTPS URL or base64' : 'HTTPS URL or base64';
}

/** What a document tool returns by default, and what to do with a link. */
export function defaultDelivery(io: IoModes): string {
  return io.allowFileOutput
    ? 'Returns text and images (png, jpg, gif, webp) inline; other formats are saved to a temp file whose path is returned.'
    : 'Returns text and images (png, jpg, gif, webp) inline; other formats as a one-time download link: give it to ' +
      'the user as is, never open it yourself (the first download consumes it).';
}

/** `asAttachment` description: the default delivery it overrides differs per transport. */
export function asAttachmentDescription(io: IoModes): string {
  return 'If true, return the file itself as a base64 attachment, for any format, instead of the default ' +
    (io.allowFileOutput ? '(temp file or inline).' : '(link or inline). Some clients, such as claude.ai, cannot open it.');
}

/** `returnLink` description; `extra` adds a tool-specific sentence. */
export function returnLinkDescription(io: IoModes, extra = ''): string {
  return (io.allowFileOutput
    ? 'If true, return a one-time download link instead of the file, for the user to open (never fetch it yourself). '
    : 'If false, return the file itself (as asAttachment). True by default for formats not returned inline. ') +
    `Exclusive with ${io.allowFileOutput ? 'outputPath and ' : ''}asAttachment.` + extra;
}

/**
 * `outputPath` description, stdio only: over HTTP the parameter is accepted (a caller that sends it gets the
 * explanatory runtime error) but not listed (see withHiddenFields in index.ts).
 */
export function outputPathDescription(noun: string): string {
  return `Local path to save the ${noun} to, e.g. "~/out.pdf"; returns the path and size. Never overwrites a file.`;
}
