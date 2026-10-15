import { createHash } from 'node:crypto';

/**
 * Cache key for a bearer token: its SHA-256, so a cache never holds a raw token as a key.
 */
export function tokenCacheKey(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/**
 * A bounded LRU map whose entries also expire. A Map keeps insertion order, so the first key is the least
 * recently used one: a hit moves its entry to the end, and an insertion past `maxEntries` drops the first.
 */
export class LruCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    readonly maxEntries: number,
    private readonly now: () => number = Date.now
  ) {}

  get size(): number {
    return this.entries.size;
  }

  keys(): IterableIterator<string> {
    return this.entries.keys();
  }

  /** The live value for `key`, or undefined when it is missing or expired. */
  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAt <= this.now()) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }
}
