import { describe, test, expect } from 'vitest';
import { convertDocumentSchemaFor } from '../../../src/tools/convert.js';
import { renderDocumentSchemaFor } from '../../../src/tools/render.js';
import { uploadTemplateSchemaFor, downloadTemplateSchemaFor } from '../../../src/tools/templates.js';
import { handleGetCapabilities } from '../../../src/tools/info.js';

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
