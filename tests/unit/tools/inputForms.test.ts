import { describe, test, expect } from 'vitest';
import { z } from 'zod';
import { convertDocumentSchemaFor } from '../../../src/tools/convert.js';
import { renderDocumentSchemaFor } from '../../../src/tools/render.js';
import { uploadTemplateSchemaFor, downloadTemplateSchemaFor } from '../../../src/tools/templates.js';
import { handleGetCapabilities } from '../../../src/tools/info.js';
import { transportToolsFor } from '../../../src/tools/index.js';

const STDIO = { allowLocalPath: true, allowFileOutput: true };
const HTTP = { allowLocalPath: false, allowFileOutput: false };
const desc = (field: { description?: string }) => field.description ?? '';

describe('transport-dependent schema wording', () => {
  test('stdio advertises local file paths on every file input', () => {
    expect(desc(convertDocumentSchemaFor(STDIO).file)).toMatch(/Local file path/);
    expect(desc(renderDocumentSchemaFor(STDIO).template)).toMatch(/Local file path/);
    expect(desc(uploadTemplateSchemaFor(STDIO).template)).toMatch(/Local file path/);
  });

  test('http never advertises local file paths, and says why', () => {
    for (const d of [
      desc(convertDocumentSchemaFor(HTTP).file),
      desc(renderDocumentSchemaFor(HTTP).template),
      desc(uploadTemplateSchemaFor(HTTP).template),
    ]) {
      expect(d).not.toMatch(/Local file path —/);
      expect(d).toMatch(/NOT accepted/);
      expect(d).toMatch(/base64/);
    }
  });

  test('http marks outputPath unavailable instead of describing it', () => {
    expect(desc(convertDocumentSchemaFor(HTTP).outputPath)).toMatch(/NOT AVAILABLE/);
    expect(desc(renderDocumentSchemaFor(HTTP).outputPath)).toMatch(/NOT AVAILABLE/);
    expect(desc(downloadTemplateSchemaFor(HTTP).outputPath)).toMatch(/NOT AVAILABLE/);
    expect(desc(convertDocumentSchemaFor(STDIO).outputPath)).not.toMatch(/NOT AVAILABLE/);
  });

  test('http outputPath names returnLink only on the tools that have it', () => {
    expect(downloadTemplateSchemaFor(HTTP)).not.toHaveProperty('returnLink');
    expect(desc(downloadTemplateSchemaFor(HTTP).outputPath)).not.toMatch(/returnLink/);
    expect(desc(downloadTemplateSchemaFor(HTTP).outputPath)).toMatch(/asAttachment/);
    for (const schema of [convertDocumentSchemaFor(HTTP), renderDocumentSchemaFor(HTTP)]) {
      expect(schema).toHaveProperty('returnLink');
      expect(desc(schema.outputPath)).toMatch(/returnLink for a one-time download URL/);
    }
    // The tools/list payload is built from the cached transport variant: same wording there.
    const http = transportToolsFor(HTTP);
    expect(JSON.stringify(z.toJSONSchema(http.downloadTemplateInput))).not.toMatch(/returnLink/);
    expect(JSON.stringify(z.toJSONSchema(http.convertDocumentInput))).toMatch(/returnLink for a one-time download URL/);
    expect(JSON.stringify(z.toJSONSchema(http.renderDocumentInput))).toMatch(/returnLink for a one-time download URL/);
  });

  test('JSON-by-reference params drop the local-path option on http', () => {
    const http = renderDocumentSchemaFor(HTTP);
    for (const key of ['data', 'complement', 'translations', 'enum', 'currencyRates'] as const) {
      expect(desc(http[key])).not.toMatch(/local file path \(e\.g\./);
    }
    expect(desc(renderDocumentSchemaFor(STDIO).data)).toMatch(/local file path/);
  });

  test('get_capabilities follows the transport too', () => {
    const stdio = handleGetCapabilities(STDIO).content[0].text;
    const http = handleGetCapabilities(HTTP).content[0].text;
    expect(stdio).toMatch(/a local file path, an HTTPS URL/);
    expect(http).toMatch(/not accepted over HTTP/);
    expect(http).not.toMatch(/\*\*Accepted file input:\*\* a local file path/);
  });
});

describe('transport variants are built once and cached', () => {
  test('the same I/O modes always return the same wrapped schemas (registerTools runs per HTTP request)', () => {
    expect(transportToolsFor(HTTP)).toBe(transportToolsFor({ ...HTTP }));
    expect(transportToolsFor(STDIO)).toBe(transportToolsFor({ ...STDIO }));
    expect(transportToolsFor(HTTP)).not.toBe(transportToolsFor(STDIO));
  });

  test('the document tools\' annotations are part of the cached variant: not read-only over stdio', () => {
    expect(transportToolsFor(STDIO).documentToolHints)
      .toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
    expect(transportToolsFor(HTTP).documentToolHints)
      .toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
    expect(transportToolsFor({ ...STDIO }).documentToolHints).toBe(transportToolsFor(STDIO).documentToolHints);
  });

  test('tool descriptions follow the transport as well as the parameters', () => {
    const http = transportToolsFor(HTTP);
    const stdio = transportToolsFor(STDIO);
    expect(http.convertDocumentDescription).toMatch(/local file paths are not accepted over HTTP/);
    expect(http.renderDocumentDescription).toMatch(/local file paths are not accepted over HTTP/);
    expect(stdio.convertDocumentDescription).toMatch(/a local file path, an HTTPS URL/);
  });
});

describe('input formats (live: legacy binary DOC/XLS/PPT are rejected as input)', () => {
  test('file/template descriptions list RTF and PDF, not DOC, XLS or PPT as accepted inputs', () => {
    for (const d of [
      desc(convertDocumentSchemaFor(HTTP).file),
      desc(renderDocumentSchemaFor(HTTP).template),
      desc(uploadTemplateSchemaFor(HTTP).template),
    ]) {
      const accepted = d.match(/Supported input formats: ([^.]+)\./)?.[1] ?? '';
      expect(accepted).toMatch(/\bRTF\b/);
      expect(accepted).toMatch(/\bPDF\b/);
      expect(accepted).not.toMatch(/\b(DOC|XLS|PPT)\b/);
      expect(d).toMatch(/DOC, XLS and PPT are rejected as input/);
    }
  });
});

describe('converter I (Carbone ICE) wording', () => {
  test('says ICE applies the Security and Watermark PDF options — never that it ignores them', async () => {
    const capabilities = (await handleGetCapabilities(STDIO)).content[0]!.text;
    for (const text of [
      desc(convertDocumentSchemaFor(STDIO).converter),
      desc(renderDocumentSchemaFor(STDIO).converter),
      capabilities,
    ]) {
      expect(text).not.toMatch(/silently ignored|only watermarks/i);
      expect(text).toMatch(/Security/);
      expect(text).toMatch(/Watermarks?\b/);
      expect(text).toMatch(/ODT/);
      expect(text).toContain('#converters-carbone-ice-limitations');
    }
  });
});
