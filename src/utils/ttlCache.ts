type CacheEntry<V> = {value: V; expiresAt: number};

class TtlCache<V> {
  private store = new Map<string, CacheEntry<V>>();

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.store.set(key, {value, expiresAt: Date.now() + ttlMs});
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}

export const createTtlCache = <V>() => new TtlCache<V>();
