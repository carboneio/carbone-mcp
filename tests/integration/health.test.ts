import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CarboneClient } from '../../src/carbone/client.js';
import { CarboneConnectionError } from '../../src/carbone/errors.js';
import { startHttpServer } from '../../src/server/http.js';

type Status = { version: string; message: string };

// /health answers at once from the last known backend status; the Carbone API is checked in the background.
// Each test starts its own server, so a failure points at one behaviour.
describe('GET /health never waits for the Carbone API', () => {
  const signals = ['SIGTERM', 'SIGINT'] as const;
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await cleanup?.();
    cleanup = undefined;
  });

  async function start(getStatus: () => Promise<Status>) {
    const listenersBefore = signals.map((s) => process.listeners(s));
    const server: Server = await startHttpServer({
      client: { getStatus } as unknown as CarboneClient, version: '0.0.0-test', port: 0, mcpPath: '/mcp',
      maxBodyBytes: 1024, maxFileBytes: 1024, allowPrivateNetwork: false, allowedOriginHostnames: [],
    });
    cleanup = async () => {
      // startHttpServer installs process-wide shutdown handlers (they call process.exit); remove them.
      for (const [i, s] of signals.entries()) {
        for (const l of process.listeners(s)) if (!listenersBefore[i].includes(l)) process.removeListener(s, l);
      }
      await new Promise((resolve) => server.close(resolve));
    };
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/health`;
    return async () => (await fetch(url)).json();
  }

  test('answers at once while the first check is still running, with a single check', async () => {
    const getStatus = vi.fn(() => new Promise<Status>(() => {})); // never settles
    const health = await start(getStatus);
    expect(await health()).toEqual({ mcp: { version: '0.0.0-test' }, carbone: { status: 'checking' } });
    expect(await health()).toEqual({ mcp: { version: '0.0.0-test' }, carbone: { status: 'checking' } });
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  test('serves the known status once the check completes, without a new check', async () => {
    const getStatus = vi.fn(async () => ({ version: '5.15.4', message: 'OK' }));
    const health = await start(getStatus);
    await health();
    await vi.waitFor(async () => expect((await health()).carbone).toEqual({ version: '5.15.4' }));
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  test('starts a new check 30 s after the previous one ended, still answering at once', async () => {
    const getStatus = vi.fn(async () => ({ version: '5.15.4', message: 'OK' }));
    const health = await start(getStatus);
    await health();
    await vi.waitFor(async () => expect((await health()).carbone).toEqual({ version: '5.15.4' }));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 30_000);
    expect((await health()).carbone).toEqual({ version: '5.15.4' });
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  test('reports an unreachable Carbone API and logs the status change', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const health = await start(async () => { throw new CarboneConnectionError('Carbone API request timed out after 60 s.'); });
    await health();
    await vi.waitFor(async () => expect((await health()).carbone)
      .toEqual({ error: 'unreachable', message: 'Carbone API request timed out after 60 s.' }));
    expect(stderr).toHaveBeenCalledWith(
      '[carbone-mcp] backend status changed: unreachable: Carbone API request timed out after 60 s.\n');
  });
});
