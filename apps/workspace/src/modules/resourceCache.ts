const DEFAULT_TTL_MS = 12_000;

interface CacheEntry<T> {
  promise: Promise<T> | null;
  updatedAt: number;
  value: T | undefined;
}

const cache = new Map<string, CacheEntry<unknown>>();

export function cachedResource<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (existing?.value !== undefined && now - existing.updatedAt < ttlMs) {
    return Promise.resolve(existing.value);
  }
  if (existing?.promise) return existing.promise;

  const entry: CacheEntry<T> = {
    promise: null,
    updatedAt: existing?.updatedAt ?? 0,
    value: existing?.value,
  };
  const promise = loader()
    .then((value) => {
      entry.value = value;
      entry.updatedAt = Date.now();
      entry.promise = null;
      return value;
    })
    .catch((error) => {
      entry.promise = null;
      if (entry.value === undefined) cache.delete(key);
      throw error;
    });
  entry.promise = promise;
  cache.set(key, entry);
  return promise;
}

export function invalidateCachedResource(key: string): void {
  cache.delete(key);
}

export function invalidateCachedResourcePrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
