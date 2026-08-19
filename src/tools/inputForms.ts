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
}

/** Wording used for the exported default schemas and anywhere a transport is not yet known. */
export const STDIO_IO: IoModes = { allowLocalPath: true, allowFileOutput: true };

/** The numbered "input forms are accepted" list for a file/template parameter. */
export function inputForms(io: IoModes): string {
  return io.allowLocalPath
    ? 'Three input forms are accepted: ' +
      '(1) Local file path — absolute or relative, e.g. "/home/user/report.docx" or "./invoice.xlsx". ' +
      '(2) HTTPS URL — the file is downloaded automatically, e.g. "https://example.com/file.pptx". ' +
      '(3) Base64-encoded string — the raw file content encoded as base64. '
    : 'Two input forms are accepted: ' +
      '(1) HTTPS URL — the file is downloaded automatically, e.g. "https://example.com/file.pptx". ' +
      '(2) Base64-encoded string — the raw file content encoded as base64. ' +
      'Local file paths are NOT accepted — this server is reached over HTTP, so a path would resolve on the ' +
      'server\'s disk rather than yours and is rejected. Upload the bytes as base64, or host the file at a URL. ';
}

/** Short form of the same idea, for prose that lists the accepted forms inline. */
export function inputFormsShort(io: IoModes): string {
  return io.allowLocalPath
    ? 'a local file path, an HTTPS URL, or a base64-encoded string'
    : 'an HTTPS URL or a base64-encoded string (local file paths are not accepted over HTTP)';
}

/** The "may be passed by reference as a string" sentence shared by the JSON params. */
export function jsonRefForms(io: IoModes): string {
  return io.allowLocalPath
    ? 'a local file path (e.g. "/data/invoices.json"), an HTTPS URL, or a base64-encoded JSON string'
    : 'an HTTPS URL or a base64-encoded JSON string (local file paths are not accepted over HTTP)';
}

/**
 * `outputPath` description. The parameter stays in the schema on HTTP so a caller that sends it still
 * gets the explanatory runtime error, but the description tells the model not to reach for it.
 */
export function outputPathDescription(noun: string, io: IoModes): string {
  if (!io.allowFileOutput) {
    return `NOT AVAILABLE on this server, which is reached over HTTP: the ${noun} would be written to the ` +
      'server\'s disk instead of yours, so passing outputPath is rejected. ' +
      'Use asAttachment to receive the bytes, or returnLink for a one-time download URL.';
  }
  return `Optional local file path to save the ${noun} to (e.g. "/home/user/out.pdf" or "~/out.pdf"). ` +
    'When set, the file is written to disk and the tool returns the saved path + size instead of embedding ' +
    'the document inline — ideal for large files.';
}
