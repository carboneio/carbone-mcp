import { writeOutputFile, type FormatArg } from '../utils/file.js';

/** Config threaded from the server into file-producing tools (set per transport in the entry points). */
export interface FileContext {
  /** Whether the tool may write outputPath to local disk (stdio only — not HTTP, where it would land on the server). */
  allowFileOutput: boolean;
  /** Maximum size in bytes for a resolved input file (from CARBONE_MAX_FILE_BYTES). */
  maxFileBytes: number;
}

/**
 * Save a generated/converted document to a local path when local file output is allowed (stdio mode),
 * otherwise return a clear rejection (HTTP mode — the file would land on the server, not the client).
 */
export async function saveOrReject(params: {
  buffer: Buffer;
  format: FormatArg;
  outputPath: string;
  allowFileOutput: boolean;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  if (!params.allowFileOutput) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text:
          'outputPath is only supported in stdio (local) mode. In HTTP mode the file would be written ' +
          'to the server, not your machine. Omit outputPath to receive the document inline.',
      }],
    };
  }

  const { path, size } = await writeOutputFile(params.outputPath, params.buffer);
  const formatName = typeof params.format === 'string' ? params.format : params.format.formatName;
  return {
    content: [{ type: 'text', text: `Document saved to ${path} (${size} bytes, ${formatName}).` }],
  };
}
