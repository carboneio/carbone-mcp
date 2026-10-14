import { describe, test, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';

/**
 * HTTP startup output, from the TypeScript entry point (tsx, no build needed). No request is made,
 * so CARBONE_BASE_URL points at an unused local port.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SERVER_KEY = 'server-secret-key';
const WARNING = 'requests without an Authorization: Bearer key use the server-level CARBONE_API_KEY';

/** A currently free TCP port (MCP_PORT must be a positive integer, so 0 is not an option). */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** Start the server in HTTP mode and return its stderr up to the "running" line. */
async function startupLog(env: Record<string, string>): Promise<string> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: ROOT,
    env: {
      ...getDefaultEnvironment(),
      MCP_TRANSPORT: 'http', MCP_PORT: String(await freePort()), CARBONE_BASE_URL: 'http://127.0.0.1:9', ...env,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    let log = '';
    await new Promise<void>((resolve, reject) => {
      child.stderr!.on('data', (chunk) => { log += chunk; if (log.includes('running in HTTP mode')) resolve(); });
      child.once('exit', (code) => reject(new Error(`server exited early (${code}): ${log}`)));
    });
    return log;
  } finally {
    child.kill();
  }
}

describe('HTTP startup: shared server key warning', () => {
  test('warns once when CARBONE_API_KEY is set and client keys are not required — without printing the key', async () => {
    const log = await startupLog({ CARBONE_API_KEY: SERVER_KEY });
    expect(log.split(WARNING)).toHaveLength(2);
    expect(log).toContain('CARBONE_REQUIRE_CLIENT_AUTH_HEADER=true');
    expect(log).not.toContain(SERVER_KEY);
  }, 15_000);

  test.each([
    ['client keys are required', { CARBONE_API_KEY: SERVER_KEY, CARBONE_REQUIRE_CLIENT_AUTH_HEADER: 'true' }],
    ['there is no server key', {}],
  ])('stays silent when %s', async (_, env) => {
    expect(await startupLog(env)).not.toContain(WARNING);
  }, 15_000);
});
