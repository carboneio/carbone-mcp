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

  // ── MCP_ALLOWED_ORIGINS ──────────────────────────────────────────────────
  describe('MCP_ALLOWED_ORIGINS', () => {
    test.each([undefined, '', ' , ,, '])('defaults to no extra hostnames when %j', (value) => {
      stubHttp();
      vi.stubEnv('MCP_ALLOWED_ORIGINS', value);
      expect(loadConfig().allowedOriginHostnames).toEqual([]);
    });

    test('trims, lowercases and drops empty entries', () => {
      stubHttp();
      vi.stubEnv('MCP_ALLOWED_ORIGINS', ' App.Example.com, ,localhost,[FD00::1] ,');
      expect(loadConfig().allowedOriginHostnames).toEqual(['app.example.com', 'localhost', '[fd00::1]']);
    });

    test('accepts the browser-extension forms: "<scheme>://*" and a bare extension ID', () => {
      stubHttp();
      vi.stubEnv('MCP_ALLOWED_ORIGINS', 'MOZ-EXTENSION://*,abcdefghijklmnopabcdefghijklmnop');
      expect(loadConfig().allowedOriginHostnames).toEqual(['moz-extension://*', 'abcdefghijklmnopabcdefghijklmnop']);
    });

    // Each of these could never equal a browser Origin's hostname, so it would silently 403 every browser client.
    test.each([
      'https://app.example.com', // full origin
      'app.example.com:8080',    // port
      'app.example.com/mcp',     // path
      '*.example.com',           // no wildcard support
      '*',                       // no allow-all
      'https://*',               // the SDK never honours http(s)://*
      '127.1',                   // not in the normalized form browsers send
    ])('throws a clear error for "%s"', (entry) => {
      stubHttp();
      vi.stubEnv('MCP_ALLOWED_ORIGINS', `localhost,${entry}`);
      expect(() => loadConfig()).toThrow(
        `Invalid MCP_ALLOWED_ORIGINS entry "${entry}". Must be a hostname without scheme, port, path or wildcard`
      );
    });
  });
});

// ─── OAuth mode (MCP_OAUTH_* and MCP_RESOURCE_URL) ──────────────────────────

describe('loadConfig: OAuth mode', () => {
  const OAUTH_ENV = {
    MCP_OAUTH_CLIENT_ID: 'mcp-server',
    MCP_OAUTH_CLIENT_SECRET: 'server-secret',
    MCP_RESOURCE_URL: 'https://mcp.example.test',
  };

  /** HTTP, no server key, MCP_PATH "/" (the hosted setup), and the given OAuth variables (all others unset). */
  function stubOAuth(env: Partial<Record<'MCP_OAUTH_ISSUER' | 'MCP_TRUST_PROXY_HOPS' | keyof typeof OAUTH_ENV, string>> = OAUTH_ENV) {
    stubHttp('');
    vi.stubEnv('MCP_PATH', '/');
    for (const name of ['MCP_OAUTH_ISSUER', 'MCP_TRUST_PROXY_HOPS', ...Object.keys(OAUTH_ENV)]) vi.stubEnv(name, '');
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  }

  test('API-key mode (default): no OAuth variable, no oauth config, nothing new required', () => {
    stubOAuth({});
    const config = loadConfig();
    expect(config.oauth).toBeUndefined();
    expect(config.requireClientAuth).toBe(false);
  });

  test('all set: OAuth mode with the default issuer, and client auth forced', () => {
    stubOAuth();
    const config = loadConfig();
    expect(config.oauth).toEqual({
      issuer: 'https://account.carbone.io', clientId: 'mcp-server', clientSecret: 'server-secret', resourceUrl: 'https://mcp.example.test',
      trustProxyHops: 0,
    });
    expect(config.requireClientAuth).toBe(true);
  });

  test('MCP_OAUTH_ISSUER overrides the issuer', () => {
    stubOAuth({ ...OAUTH_ENV, MCP_OAUTH_ISSUER: 'https://auth.example.test' });
    expect(loadConfig().oauth?.issuer).toBe('https://auth.example.test');
  });

  test.each([
    [{ MCP_OAUTH_CLIENT_ID: 'id' }, 'set MCP_OAUTH_CLIENT_SECRET, MCP_RESOURCE_URL,'],
    [{ MCP_OAUTH_CLIENT_ID: 'id', MCP_OAUTH_CLIENT_SECRET: 's' }, 'set MCP_RESOURCE_URL,'],
    [{ MCP_RESOURCE_URL: 'https://mcp.example.test' }, 'set MCP_OAUTH_CLIENT_ID, MCP_OAUTH_CLIENT_SECRET,'],
    [{ MCP_OAUTH_ISSUER: 'https://auth.example.test' }, 'set MCP_OAUTH_CLIENT_ID, MCP_OAUTH_CLIENT_SECRET, MCP_RESOURCE_URL,'],
  ])('a partial set %j is a startup error naming what is missing, never API-key mode', (env, missing) => {
    stubOAuth(env);
    expect(() => loadConfig()).toThrow(`OAuth mode is partially configured: ${missing}`);
  });

  test('refuses to start with CARBONE_API_KEY set: no server key in OAuth mode', () => {
    stubOAuth();
    vi.stubEnv('CARBONE_API_KEY', 'server-key');
    expect(() => loadConfig()).toThrow('CARBONE_API_KEY must not be set in OAuth mode');
  });

  test('refuses the stdio transport', () => {
    stubOAuth();
    vi.stubEnv('MCP_TRANSPORT', 'stdio');
    vi.stubEnv('CARBONE_BASE_URL', 'https://carbone.example.test');
    expect(() => loadConfig()).toThrow('OAuth mode (MCP_OAUTH_* variables) is for the HTTP transport');
  });

  test.each([
    'http://auth.example.test',
    'not a url',
    'https://user:pw@auth.example.test',
    // Endpoints are built from the origin, so a path would be dropped silently
    'https://auth.example.test/tenant',
    // Advertised as is: a client would refuse the server's own issuer "https://auth.example.test" (RFC 8414 §3.3)
    'https://auth.example.test/',
    'https://Auth.Example.test',
    'https://auth.example.test?x=1',
    'https://auth.example.test#f',
  ])('refuses an issuer that is not an https origin written canonically: %s', (issuer) => {
    stubOAuth({ ...OAUTH_ENV, MCP_OAUTH_ISSUER: issuer });
    expect(() => loadConfig()).toThrow(`Invalid MCP_OAUTH_ISSUER value "${issuer}". Must be an https origin without a path or trailing slash`);
  });

  test('MCP_TRUST_PROXY_HOPS: 0 by default, a small whole number otherwise', () => {
    stubOAuth({ ...OAUTH_ENV, MCP_TRUST_PROXY_HOPS: '1' });
    expect(loadConfig().oauth?.trustProxyHops).toBe(1);
    for (const value of ['-1', '1.5', 'one', '100']) {
      stubOAuth({ ...OAUTH_ENV, MCP_TRUST_PROXY_HOPS: value });
      expect(() => loadConfig()).toThrow(`Invalid MCP_TRUST_PROXY_HOPS value "${value}"`);
    }
  });

  // ── (a) D2: the resource is the URL clients connect to ───────────────────

  test('an origin-only resource with MCP_PATH "/" is accepted', () => {
    stubOAuth();
    expect(loadConfig().oauth?.resourceUrl).toBe('https://mcp.example.test');
  });

  test('a resource with a path matching MCP_PATH is accepted', () => {
    stubOAuth({ ...OAUTH_ENV, MCP_RESOURCE_URL: 'https://mcp.example.test/mcp' });
    vi.stubEnv('MCP_PATH', '/mcp');
    expect(loadConfig().oauth?.resourceUrl).toBe('https://mcp.example.test/mcp');
  });

  test.each([
    ['https://mcp.example.test/mcp', '/', 'MCP_RESOURCE_URL path "/mcp" must equal MCP_PATH "/"'],
    ['https://mcp.example.test', '/mcp', 'MCP_RESOURCE_URL path "/" must equal MCP_PATH "/mcp"'],
  ])('a resource %s with MCP_PATH %s is a startup error naming both', (resource, mcpPath, message) => {
    stubOAuth({ ...OAUTH_ENV, MCP_RESOURCE_URL: resource });
    vi.stubEnv('MCP_PATH', mcpPath);
    expect(() => loadConfig()).toThrow(message);
  });

  test.each([
    ['https://mcp.example.test/', 'https://mcp.example.test'],       // trailing slash on an origin
    ['https://MCP.example.test', 'https://mcp.example.test'],        // not lowercased
    ['https://mcp.example.test:443', 'https://mcp.example.test'],    // default port
    ['https://mcp.example.test/a/../mcp', 'https://mcp.example.test/mcp'], // path not normalized
  ])('a non-canonical resource %s is refused, naming the canonical form', (resource, canonical) => {
    stubOAuth({ ...OAUTH_ENV, MCP_RESOURCE_URL: resource });
    expect(() => loadConfig()).toThrow(`Write it in canonical form: "${canonical}"`);
  });

  test.each([
    'https://mcp.example.test?x=1',
    'https://mcp.example.test/?',
    'https://mcp.example.test#frag',
    'https://user:pw@mcp.example.test',
    'http://mcp.example.test',
  ])('%s is refused (https, no query, fragment or credentials)', (resource) => {
    stubOAuth({ ...OAUTH_ENV, MCP_RESOURCE_URL: resource });
    expect(() => loadConfig()).toThrow('Must be an https URL without query, fragment or credentials');
  });

  test('http is accepted on a loopback host (local testing)', () => {
    stubOAuth({ ...OAUTH_ENV, MCP_RESOURCE_URL: 'http://localhost:3000' });
    expect(loadConfig().oauth?.resourceUrl).toBe('http://localhost:3000');
  });

  test('a resource that is not a URL is refused', () => {
    stubOAuth({ ...OAUTH_ENV, MCP_RESOURCE_URL: 'mcp.example.test' });
    expect(() => loadConfig()).toThrow('Invalid MCP_RESOURCE_URL value "mcp.example.test". Must be an absolute URL');
  });
});
