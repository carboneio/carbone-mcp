import { describe, test, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';

/**
 * stdio message size, through the real entry point (tsx, no build needed). The SDK's StdioServerTransport
 * closes the session on a message over STDIO_DEFAULT_MAX_BUFFER_SIZE (10 MB); the server raises that limit
 * to MCP_MAX_BODY_BYTES (60 MB by default), like an HTTP request body. No Carbone request can succeed:
 * CARBONE_BASE_URL points at a closed local port, so the tool call fails fast with a connection error.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
/** ~16 MB of base64: over the SDK's 10 MB default, under the 60 MB default of MCP_MAX_BODY_BYTES. */
const BIG_FILE = 'A'.repeat(16 * 1024 * 1024);

async function connect(env: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: 'stdio-size-test', version: '0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/index.ts'],
    cwd: ROOT,
    env: { ...getDefaultEnvironment(), CARBONE_API_KEY: 'unused', CARBONE_BASE_URL: 'http://127.0.0.1:9', ...env },
    stderr: 'ignore',
  }));
  return client;
}

describe('stdio: one message may be up to MCP_MAX_BODY_BYTES', () => {
  test('a ~16 MB message is processed and the session stays alive', async () => {
    const client = await connect();
    try {
      const r = await client.callTool({ name: 'convert_document', arguments: { file: BIG_FILE, convertTo: 'pdf' } });
      // The message was read and the tool ran: it only failed on the unreachable Carbone API.
      expect(r.isError).toBe(true);
      expect((r.content as Array<{ text: string }>)[0]!.text).toMatch(/Could not reach the Carbone API/);
      expect((await client.listTools()).tools).toHaveLength(11);
    } finally {
      await client.close();
    }
  }, 60_000);

  test('past MCP_MAX_BODY_BYTES the SDK closes the session (the limit is the one configured)', async () => {
    const client = await connect({ MCP_MAX_BODY_BYTES: String(8 * 1024 * 1024) });
    try {
      await expect(
        client.callTool({ name: 'convert_document', arguments: { file: BIG_FILE, convertTo: 'pdf' } }, { timeout: 20_000 })
      ).rejects.toThrow();
    } finally {
      await client.close();
    }
  }, 60_000);
});
