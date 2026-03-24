import { describe, test, expect, vi } from 'vitest';
import { handleGetApiStatus, handleGetCapabilities } from '../../../src/tools/info.js';
import type { CarboneClient } from '../../../src/carbone/client.js';

const client = {
  getStatus: vi.fn(),
} as unknown as CarboneClient;

describe('handleGetApiStatus', () => {
  test('returns version and message on success', async () => {
    vi.mocked(client.getStatus).mockResolvedValueOnce({ version: '4.22.9', message: 'OK' });

    const result = await handleGetApiStatus(client);

    expect(result.content[0].type).toBe('text');
    expect((result.content[0] as { type: 'text'; text: string }).text).toContain('4.22.9');
    expect((result.content[0] as { type: 'text'; text: string }).text).toContain('OK');
  });

  test('returns isError on failure', async () => {
    vi.mocked(client.getStatus).mockRejectedValueOnce(new Error('Network error'));

    const result = await handleGetApiStatus(client);

    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: 'text'; text: string }).text).toContain('Network error');
  });
});

describe('handleGetCapabilities', () => {
  test('returns text content', () => {
    const result = handleGetCapabilities();

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
  });

  test('lists all tool names', () => {
    const { text } = result(handleGetCapabilities());

    expect(text).toContain('convert_document');
    expect(text).toContain('render_document');
    expect(text).toContain('list_templates');
    expect(text).toContain('list_categories');
    expect(text).toContain('list_tags');
    expect(text).toContain('upload_template');
    expect(text).toContain('update_template_metadata');
    expect(text).toContain('delete_template');
    expect(text).toContain('download_template');
    expect(text).toContain('get_api_status');
    expect(text).toContain('get_capabilities');
  });

  test('lists all resource URIs', () => {
    const { text } = result(handleGetCapabilities());

    expect(text).toContain('carbone://templates');
    expect(text).toContain('carbone://categories');
    expect(text).toContain('carbone://tags');
    expect(text).toContain('carbone://status');
  });

  test('includes documentation links', () => {
    const { text } = result(handleGetCapabilities());

    expect(text).toContain('carbone.io');
  });
});

// Helper: extract text from the first content item
function result(r: ReturnType<typeof handleGetCapabilities>) {
  const item = r.content[0];
  if (item.type !== 'text') throw new Error('Expected text content');
  return { text: item.text };
}
