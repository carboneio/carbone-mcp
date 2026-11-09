import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { callerIdFrom, loggedCaller } from '../../../src/server/caller.js';

describe('loggedCaller', () => {
  test('the OAuth subject in clear (clipped), a key only as its SHA-256 prefix, nothing for the server key', () => {
    const key = 'example-api-key';
    expect(loggedCaller({ token: 'exchanged', extra: { sub: '42' } })).toBe('sub:42');
    expect(loggedCaller({ token: 'exchanged', extra: { sub: 's'.repeat(500) } })).toBe(`sub:${'s'.repeat(100)}`);
    expect(loggedCaller({ token: key })).toBe(`key:${createHash('sha256').update(key).digest('hex').slice(0, 12)}`);
    expect(loggedCaller({ token: key, extra: { sub: '' } })).not.toContain(key);
    expect(loggedCaller(undefined)).toBeUndefined();
    expect(loggedCaller({ token: '' })).toBeUndefined();
  });

  test('callerIdFrom keeps the raw key, for what a later request comes back to: never logged', () => {
    expect(callerIdFrom({ http: { authInfo: { token: 'k' } } })).toBe('key:k');
  });
});
