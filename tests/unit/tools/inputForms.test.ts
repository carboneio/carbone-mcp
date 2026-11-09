import { describe, test, expect } from 'vitest';
import { z } from 'zod';
import { convertDocumentDescriptionFor, convertDocumentSchemaFor } from '../../../src/tools/convert.js';
import { OutputFormatSchema } from '../../../src/validation/formats.js';
import { renderDocumentDescriptionFor, renderDocumentSchemaFor } from '../../../src/tools/render.js';
import { uploadTemplateSchemaFor, downloadTemplateSchemaFor } from '../../../src/tools/templates.js';
import { handleGetCapabilities } from '../../../src/tools/info.js';
import { transportToolsFor } from '../../../src/tools/index.js';

const STDIO = { allowLocalPath: true, allowFileOutput: true };
const HTTP = { allowLocalPath: false, allowFileOutput: false };
const desc = (field: { description?: string }) => field.description ?? '';
const listed = (schema: unknown) => JSON.stringify((schema as { '~standard': { jsonSchema: { input: (o: object) => unknown } } })['~standard'].jsonSchema.input({ target: 'draft-2020-12' }));

describe('transport-dependent schema wording', () => {
  test('stdio advertises local file paths on every file input', () => {
    expect(desc(convertDocumentSchemaFor(STDIO).file)).toMatch(/absolute local path/);
    expect(desc(renderDocumentSchemaFor(STDIO).template)).toMatch(/absolute local path/);
    expect(desc(uploadTemplateSchemaFor(STDIO).template)).toMatch(/absolute local path/);
  });

  test('http never advertises local file paths, and says why', () => {
    for (const d of [
      desc(convertDocumentSchemaFor(HTTP).file),
      desc(renderDocumentSchemaFor(HTTP).template),
      desc(uploadTemplateSchemaFor(HTTP).template),
    ]) {
      expect(d).not.toMatch(/absolute local path/);
      expect(d).toMatch(/local paths are refused over HTTP/);
      expect(d).toMatch(/base64/);
    }
  });

  test('http does not list outputPath, but still accepts it (for the explanatory error)', () => {
    const http = transportToolsFor(HTTP);
    for (const input of [http.convertDocumentInput, http.renderDocumentInput, http.downloadTemplateInput]) {
      expect(listed(input)).not.toMatch(/outputPath/);
      expect(input['~standard'].validate({ outputPath: '/tmp/x.pdf', templateId: 'x', file: 'x', convertTo: 'pdf' })).not.toHaveProperty('issues');
    }
    expect(listed(transportToolsFor(STDIO).convertDocumentInput)).toMatch(/outputPath/);
  });

  test('JSON-by-reference params drop the local-path option on http', () => {
    const http = renderDocumentSchemaFor(HTTP);
    for (const key of ['data', 'complement', 'translations', 'enum', 'currencyRates'] as const) {
      expect(desc(http[key])).not.toMatch(/local path/);
    }
    expect(desc(renderDocumentSchemaFor(STDIO).data)).toMatch(/local path/);
  });

  test('get_capabilities follows the transport too', () => {
    const stdio = handleGetCapabilities(STDIO).content[0].text;
    const http = handleGetCapabilities(HTTP).content[0].text;
    expect(stdio).toMatch(/\*\*Accepted file input:\*\* local path, HTTPS URL or base64/);
    expect(http).toMatch(/\*\*Accepted file input:\*\* HTTPS URL or base64\./);
    expect(http).toMatch(/one-time download link: give it to the user as is, never open it/);
    expect(stdio).toMatch(/saved to a temp file/);
  });
});

describe('default delivery wording (HTTP: one-time link for binary outputs)', () => {
  test('http names the link as the default, says to give it to the user, and offers no outputPath', () => {
    for (const d of [renderDocumentDescriptionFor(HTTP), convertDocumentDescriptionFor(HTTP)]) {
      expect(d).toMatch(/one-time download link: give it to the user as is, never open it yourself/);
    }
    for (const schema of [convertDocumentSchemaFor(HTTP), renderDocumentSchemaFor(HTTP)]) {
      expect(desc(schema.asAttachment)).toMatch(/instead of the default \(link or inline\)/);
      expect(desc(schema.returnLink)).toMatch(/Exclusive with asAttachment\./);
    }
  });

  test('stdio keeps the temp-file default, and offers outputPath with the link', () => {
    expect(renderDocumentDescriptionFor(STDIO)).toMatch(/saved to a temp file/);
    for (const schema of [convertDocumentSchemaFor(STDIO), renderDocumentSchemaFor(STDIO)]) {
      expect(desc(schema.asAttachment)).toMatch(/temp file or inline/);
      expect(desc(schema.returnLink)).toMatch(/never fetch it yourself.*Exclusive with outputPath and asAttachment\./);
    }
  });
});

describe('transport variants are built once and cached', () => {
  test('the same I/O modes always return the same wrapped schemas (registerTools runs per HTTP request)', () => {
    expect(transportToolsFor(HTTP)).toBe(transportToolsFor({ ...HTTP }));
    expect(transportToolsFor(STDIO)).toBe(transportToolsFor({ ...STDIO }));
    expect(transportToolsFor(HTTP)).not.toBe(transportToolsFor(STDIO));
  });

  test('download_template annotations are part of the cached variant: not read-only over stdio', () => {
    expect(transportToolsFor(STDIO).downloadToolHints)
      .toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
    expect(transportToolsFor(HTTP).downloadToolHints)
      .toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  });

  test('tool descriptions follow the transport as well as the parameters', () => {
    const http = transportToolsFor(HTTP);
    const stdio = transportToolsFor(STDIO);
    expect(http.renderDocumentDescription).toMatch(/template \(HTTPS URL or base64\)/);
    expect(stdio.renderDocumentDescription).toMatch(/template \(local path, HTTPS URL or base64\)/);
    expect(http.downloadTemplateDescription).toMatch(/base64 attachment/);
    expect(stdio.downloadTemplateDescription).toMatch(/temp file/);
    expect(stdio.uploadTemplateDescription).not.toMatch(/exactly one of/);
    expect(transportToolsFor({ ...HTTP, allowUploadUrl: true }).uploadTemplateDescription)
      .toMatch(/Pass exactly one of template, attachedTemplate, requestUploadUrl\./);
  });
});

describe('input formats (live: legacy binary DOC/XLS/PPT are rejected as input)', () => {
  test('file/template descriptions list RTF and PDF, not DOC, XLS or PPT as accepted inputs', () => {
    for (const d of [
      desc(convertDocumentSchemaFor(HTTP).file),
      desc(renderDocumentSchemaFor(HTTP).template),
      desc(uploadTemplateSchemaFor(HTTP).template),
    ]) {
      const accepted = d.match(/Formats: ([^;]+);/)?.[1] ?? '';
      expect(accepted).toMatch(/\bRTF\b/);
      expect(accepted).toMatch(/\bPDF\b/);
      expect(accepted).not.toMatch(/\b(DOC|XLS|PPT)\b/);
      expect(d).toMatch(/not the legacy binary DOC, XLS or PPT/);
    }
  });
});

describe('converter I (Carbone ICE) wording', () => {
  test('get_capabilities says ICE applies the Security and Watermark PDF options; no text says it ignores them', async () => {
    const capabilities = (await handleGetCapabilities(STDIO)).content[0]!.text;
    for (const text of [desc(convertDocumentSchemaFor(STDIO).converter), capabilities]) {
      expect(text).not.toMatch(/silently ignored|only watermarks/i);
      expect(text).toMatch(/ODT/);
    }
    expect(capabilities).toMatch(/Security/);
    expect(capabilities).toContain('#converters-carbone-ice-limitations');
    // v5.16.0: a DOCX with tracked changes is rendered as its current version, so it is no longer unsupported.
    expect(capabilities).toMatch(/tracked changes is rendered as its current version/);
    expect(capabilities).toMatch(/bookmarks and endnotes/);
  });
});

describe('converter C (Chromium) image export wording (Carbone v5.17.0)', () => {
  test('names the image options on formatOptions, the details in get_capabilities', () => {
    const formatOptions = desc(OutputFormatSchema.def.options[1].shape.formatOptions);
    expect(desc(convertDocumentSchemaFor(STDIO).converter)).toMatch(/SVG/);
    expect(formatOptions).toMatch(/Scale/);
    // A parameter description names no tool (it stays listed when that tool is disabled): the instructions point there.
    expect(formatOptions).not.toMatch(/get_capabilities/);
    expect(handleGetCapabilities(STDIO).content[0].text).toMatch(/FullPage/);
    expect(convertDocumentDescriptionFor(STDIO)).toMatch(/returned inline/);
  });

  test('formatName is checked against the known formats without listing them again', () => {
    const object = OutputFormatSchema.def.options[1];
    expect(object.safeParse({ formatName: 'pdf' }).success).toBe(true);
    expect(object.safeParse({ formatName: 'nope' }).error?.issues[0]?.message).toMatch(/^Unknown format\. Use one of: pdf, docx/);
    expect(JSON.stringify(z.toJSONSchema(object))).not.toMatch(/"enum"/);
  });
});
