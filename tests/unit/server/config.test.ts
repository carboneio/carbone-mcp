import { describe, test, expect, afterEach, vi } from 'vitest';
import { loadConfig } from '../../../src/server/config.js';
import { CarboneClient } from '../../../src/carbone/client.js';

afterEach(() => vi.unstubAllEnvs());

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Set the minimum env required for a valid stdio config. */
function stubStdio(apiKey = 'test-key') {
  vi.stubEnv('MCP_TRANSPORT', 'stdio');
  vi.stubEnv('CARBONE_API_KEY', apiKey);
  vi.stubEnv('CARBONE_BASE_URL', CarboneClient.CLOUD_API_URL);
}

/** Set the minimum env required for a valid http config. */
function stubHttp(apiKey = '') {
  vi.stubEnv('MCP_TRANSPORT', 'http');
  vi.stubEnv('CARBONE_API_KEY', apiKey);
  vi.stubEnv('CARBONE_BASE_URL', CarboneClient.CLOUD_API_URL);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('loadConfig', () => {

  // ── API key validation ───────────────────────────────────────────────────

  describe('CARBONE_API_KEY validation', () => {
    test('throws in stdio mode when CARBONE_API_KEY is missing (cloud API)', () => {
      vi.stubEnv('MCP_TRANSPORT', 'stdio');
      vi.stubEnv('CARBONE_API_KEY', '');
      vi.stubEnv('CARBONE_BASE_URL', CarboneClient.CLOUD_API_URL);

      expect(() => loadConfig()).toThrow('CARBONE_API_KEY environment variable is required');
    });

    test('throws in stdio mode when CARBONE_API_KEY is empty string (cloud API)', () => {
      stubStdio('');
      expect(() => loadConfig()).toThrow('CARBONE_API_KEY environment variable is required');
    });

    test('does NOT throw in http mode when CARBONE_API_KEY is missing (cloud API)', () => {
      stubHttp('');
      expect(() => loadConfig()).not.toThrow();
    });

    test('does NOT throw in http mode when CARBONE_API_KEY is empty string (cloud API)', () => {
      stubHttp('');
      expect(() => loadConfig()).not.toThrow();
    });

    test('succeeds in http mode when CARBONE_API_KEY is set', () => {
      stubHttp('my-key');
      const config = loadConfig();
      expect(config.carboneApiKey).toBe('my-key');
    });

    test('succeeds in stdio mode when CARBONE_API_KEY is set', () => {
      stubStdio('my-key');
      const config = loadConfig();
      expect(config.carboneApiKey).toBe('my-key');
    });

    test('does NOT throw in stdio mode with custom CARBONE_BASE_URL and no key (on-premise)', () => {
      vi.stubEnv('MCP_TRANSPORT', 'stdio');
      vi.stubEnv('CARBONE_API_KEY', '');
      vi.stubEnv('CARBONE_BASE_URL', 'https://carbone.my-company.com');
      expect(() => loadConfig()).not.toThrow();
    });

    test('does NOT throw in http mode with custom CARBONE_BASE_URL and no key (on-premise)', () => {
      vi.stubEnv('MCP_TRANSPORT', 'http');
      vi.stubEnv('CARBONE_API_KEY', '');
      vi.stubEnv('CARBONE_BASE_URL', 'https://carbone.my-company.com');
      expect(() => loadConfig()).not.toThrow();
    });

    test('error message mentions HTTP mode and Bearer token as alternative', () => {
      stubStdio('');
      expect(() => loadConfig()).toThrow('Authorization: Bearer');
    });
  });

  // ── MCP_TRANSPORT ────────────────────────────────────────────────────────

  describe('MCP_TRANSPORT', () => {
    test('defaults to stdio when not set', () => {
      vi.stubEnv('MCP_TRANSPORT', '');
      vi.stubEnv('CARBONE_API_KEY', 'key');
      vi.stubEnv('CARBONE_BASE_URL', CarboneClient.CLOUD_API_URL);
      // Empty string falls through to the default → 'stdio'
      // But '' !== 'stdio' && '' !== 'http' → throws invalid transport
      expect(() => loadConfig()).toThrow('Invalid MCP_TRANSPORT');
    });

    test('accepts stdio', () => {
      stubStdio();
      expect(loadConfig().transport).toBe('stdio');
    });

    test('accepts http', () => {
      stubHttp();
      expect(loadConfig().transport).toBe('http');
    });

    test('throws for an invalid transport value', () => {
      vi.stubEnv('MCP_TRANSPORT', 'websocket');
      vi.stubEnv('CARBONE_API_KEY', 'key');
      expect(() => loadConfig()).toThrow('Invalid MCP_TRANSPORT value "websocket"');
    });
  });

  // ── MCP_PATH ─────────────────────────────────────────────────────────────

  describe('MCP_PATH', () => {
    test('defaults to "/" when not set', () => {
      stubStdio();
      expect(loadConfig().mcpPath).toBe('/');
    });

    test('accepts a valid custom path', () => {
      stubStdio();
      vi.stubEnv('MCP_PATH', '/mcp');
      expect(loadConfig().mcpPath).toBe('/mcp');
    });

    test('throws when MCP_PATH does not start with "/"', () => {
      stubStdio();
      vi.stubEnv('MCP_PATH', 'mcp');
      expect(() => loadConfig()).toThrow('Must start with "/"');
    });

    test('throws when MCP_PATH is "/health" (reserved)', () => {
      stubStdio();
      vi.stubEnv('MCP_PATH', '/health');
      expect(() => loadConfig()).toThrow('reserved for the health check endpoint');
    });
  });

  // ── Numeric env vars (parsePositiveInt) ──────────────────────────────────

  describe('parsePositiveInt', () => {
    test('uses fallback when CARBONE_TIMEOUT is not set', () => {
      stubStdio();
      expect(loadConfig().timeout).toBe(60_000);
    });

    test('parses a valid CARBONE_TIMEOUT', () => {
      stubStdio();
      vi.stubEnv('CARBONE_TIMEOUT', '30000');
      expect(loadConfig().timeout).toBe(30_000);
    });

    test('throws for a non-numeric CARBONE_TIMEOUT', () => {
      stubStdio();
      vi.stubEnv('CARBONE_TIMEOUT', 'fast');
      expect(() => loadConfig()).toThrow('Invalid CARBONE_TIMEOUT value "fast"');
    });

    test('throws for a zero CARBONE_TIMEOUT', () => {
      stubStdio();
      vi.stubEnv('CARBONE_TIMEOUT', '0');
      expect(() => loadConfig()).toThrow('Invalid CARBONE_TIMEOUT value "0"');
    });

    test('throws for a negative MCP_PORT', () => {
      stubStdio();
      vi.stubEnv('MCP_PORT', '-1');
      expect(() => loadConfig()).toThrow('Invalid MCP_PORT value "-1"');
    });

    test('uses fallback when MCP_PORT is not set', () => {
      stubStdio();
      expect(loadConfig().port).toBe(3000);
    });

    test('uses fallback when MCP_MAX_BODY_BYTES is not set', () => {
      stubStdio();
      expect(loadConfig().maxBodyBytes).toBe(60 * 1024 * 1024);
    });

    test('parses a valid MCP_MAX_BODY_BYTES', () => {
      stubStdio();
      vi.stubEnv('MCP_MAX_BODY_BYTES', '5242880');
      expect(loadConfig().maxBodyBytes).toBe(5_242_880);
    });

    test('uses fallback (100 MB) when CARBONE_MAX_FILE_BYTES is not set', () => {
      stubStdio();
      expect(loadConfig().maxFileBytes).toBe(100 * 1024 * 1024);
    });

    test('parses a valid CARBONE_MAX_FILE_BYTES', () => {
      stubStdio();
      vi.stubEnv('CARBONE_MAX_FILE_BYTES', '5242880');
      expect(loadConfig().maxFileBytes).toBe(5_242_880);
    });

    test('throws for a non-positive CARBONE_MAX_FILE_BYTES', () => {
      stubStdio();
      vi.stubEnv('CARBONE_MAX_FILE_BYTES', '0');
      expect(() => loadConfig()).toThrow('Invalid CARBONE_MAX_FILE_BYTES');
    });
  });

  // ── Returned config shape ─────────────────────────────────────────────────

  describe('returned config', () => {
    test('returns all fields with correct defaults', () => {
      stubStdio('my-key');
      const config = loadConfig();
      expect(config).toMatchObject({
        carboneApiKey: 'my-key',
        carboneBaseUrl: CarboneClient.CLOUD_API_URL,
        timeout: 60_000,
        transport: 'stdio',
        port: 3000,
        mcpPath: '/',
        maxBodyBytes: 60 * 1024 * 1024,
        maxFileBytes: 100 * 1024 * 1024,
        requireClientAuth: false,
        // SSRF guard is on by default: user-supplied URLs may not reach private/internal addresses.
        allowPrivateNetwork: false,
      });
    });

    test('carboneApiKey is undefined when empty string is provided', () => {
      vi.stubEnv('MCP_TRANSPORT', 'http');
      vi.stubEnv('CARBONE_API_KEY', '');
      vi.stubEnv('CARBONE_BASE_URL', CarboneClient.CLOUD_API_URL);
      expect(loadConfig().carboneApiKey).toBeUndefined();
    });

    test('carboneBaseUrl uses CARBONE_BASE_URL env var', () => {
      vi.stubEnv('MCP_TRANSPORT', 'http');
      vi.stubEnv('CARBONE_API_KEY', '');
      vi.stubEnv('CARBONE_BASE_URL', 'https://carbone.my-company.com');
      expect(loadConfig().carboneBaseUrl).toBe('https://carbone.my-company.com');
    });
  });

  // ── CARBONE_REQUIRE_CLIENT_AUTH_HEADER ───────────────────────────────────
  describe('CARBONE_REQUIRE_CLIENT_AUTH_HEADER', () => {
    test('defaults to false when not set', () => {
      stubStdio();
      expect(loadConfig().requireClientAuth).toBe(false);
    });

    test('parses "true"', () => {
      stubHttp();
      vi.stubEnv('CARBONE_REQUIRE_CLIENT_AUTH_HEADER', 'true');
      expect(loadConfig().requireClientAuth).toBe(true);
    });

    test('parses "false"', () => {
      stubHttp();
      vi.stubEnv('CARBONE_REQUIRE_CLIENT_AUTH_HEADER', 'false');
      expect(loadConfig().requireClientAuth).toBe(false);
    });

    test('throws on a non-boolean value', () => {
      stubHttp();
      vi.stubEnv('CARBONE_REQUIRE_CLIENT_AUTH_HEADER', 'yes');
      expect(() => loadConfig()).toThrow('Invalid CARBONE_REQUIRE_CLIENT_AUTH_HEADER value "yes"');
    });
  });
});
