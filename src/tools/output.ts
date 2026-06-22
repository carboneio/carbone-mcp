import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import {
  writeOutputFile, toToolContent, isInlineFormat,
  type FormatArg, type TextContent, type ImageContent, type EmbeddedResource,
} from '../utils/file.js';

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

/**
 * Decide how a generated/converted document is returned to the client:
 *  - outputPath set                     → save to that path (stdio) or reject (HTTP)
 *  - asAttachment set                   → EmbeddedResource blob (explicit download, any format)
 *  - inline-safe (text / png,jpg,gif,webp) → returned inline (text or image block)
 *  - everything else (PDF, Office, svg/tiff/bmp, zip, …) → NOT inlined by default: clients can't
 *    render a raw binary blob (some mis-route it to an invalid image block) and base64 bloats the
 *    context. Saved to a temp file in stdio (path returned), or summarized with guidance in HTTP.
 */
export async function deliverDocument(params: {
  buffer: Buffer;
  filename: string;
  format: FormatArg;
  outputPath?: string;
  asAttachment?: boolean;
  allowFileOutput: boolean;
}): Promise<{ content: Array<TextContent | ImageContent | EmbeddedResource>; isError?: boolean }> {
  const fmt = typeof params.format === 'string' ? params.format : params.format.formatName;

  if (params.outputPath) {
    return saveOrReject({ buffer: params.buffer, format: params.format, outputPath: params.outputPath, allowFileOutput: params.allowFileOutput });
  }

  if (params.asAttachment || isInlineFormat(params.format)) {
    return { content: [toToolContent(params.buffer, params.filename, params.format, params.asAttachment)] };
  }

  // Binary, no explicit delivery requested.
  if (params.allowFileOutput) {
    // stdio: save to a temp file (persistent, re-openable — no fragile one-time link).
    const path = join(tmpdir(), basename(params.filename) || `carbone-output.${fmt}`);
    await writeFile(path, params.buffer);
    return {
      content: [{
        type: 'text',
        text: `Generated ${fmt} (${params.buffer.length} bytes) saved to ${path}. ` +
          'Pass outputPath to choose the destination, asAttachment to receive it inline, or returnLink for a download URL.',
      }],
    };
  }
  // HTTP: no local disk — return the bytes as an attachment (EmbeddedResource).
  return { content: [toToolContent(params.buffer, params.filename, params.format, true)] };
}

/** Build the tool result for a returnLink render: a public, short-lived, one-time download URL. */
export function oneTimeLinkResult(
  url: string,
  format: FormatArg
): { content: Array<TextContent | ImageContent | EmbeddedResource> } {
  const fmt = typeof format === 'string' ? format : format.formatName;
  return {
    content: [{
      type: 'text',
      text:
        `Generated ${fmt}. One-time download link (no login required):\n${url}\n\n` +
        'IMPORTANT: this link is short-lived and works only ONCE — Carbone deletes the file after the first ' +
        'download. Give it to the user as-is; do NOT fetch, open, or preview it yourself, because the first ' +
        'request consumes it and the user would then get a 404.',
    }],
  };
}

/**
 * Single entry point for turning any render/convert result into a tool result — the one place that
 * picks the output mode. Handlers just call `deliver(result, convertTo, opts)`:
 *   - async (webhook)  → the queued message
 *   - renderId (returnLink) → one-time download URL
 *   - bytes            → outputPath / asAttachment / inline / binary default (see deliverDocument)
 */
export function deliver(
  result: { buffer: Buffer; filename: string } | { renderId: string } | { async: true; message: string },
  convertTo: FormatArg | undefined,
  opts: { outputPath?: string; asAttachment?: boolean; allowFileOutput: boolean; renderUrl: (renderId: string) => string }
): Promise<{ content: Array<TextContent | ImageContent | EmbeddedResource>; isError?: boolean }> | { content: Array<TextContent | ImageContent | EmbeddedResource>; isError?: boolean } {
  if ('async' in result) {
    return { content: [{ type: 'text', text: result.message }] };
  }
  if ('renderId' in result) {
    return oneTimeLinkResult(opts.renderUrl(result.renderId), convertTo ?? 'document');
  }
  const format = convertTo ?? result.filename.split('.').pop() ?? 'pdf';
  return deliverDocument({
    buffer: result.buffer,
    filename: result.filename,
    format,
    outputPath: opts.outputPath,
    asAttachment: opts.asAttachment,
    allowFileOutput: opts.allowFileOutput,
  });
}
