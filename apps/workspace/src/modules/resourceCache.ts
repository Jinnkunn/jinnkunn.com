const DEFAULT_TTL_MS = 12_000;

interface CacheEntry<T> {
  promise: Promise<T> | null;
  updatedAt: number;
  value: T | undefined;
}

const cache = new Map<string, CacheEntry<unknown>>();

export interface CachedResourceOptions<T> {
  /** Fresh-read window. Existing callers that pass a number still map
   * directly to this value. */
  ttlMs?: number;
  /** Optional stale-while-revalidate window. When present, stale values
   * are returned immediately while one background refresh updates the
   * cache. Omit to preserve the historical "await refresh after TTL"
   * behaviour. */
  staleTtlMs?: number;
  onStaleUpdate?: (value: T) => void;
}

function normalizeOptions<T>(
  options?: number | CachedResourceOptions<T>,
): Required<Pick<CachedResourceOptions<T>, "ttlMs">> &
  Omit<CachedResourceOptions<T>, "ttlMs"> {
  if (typeof options === "number") {
    return { ttlMs: options };
  }
  return {
    ttlMs: options?.ttlMs ?? DEFAULT_TTL_MS,
    staleTtlMs: options?.staleTtlMs,
    onStaleUpdate: options?.onStaleUpdate,
  };
}

export function cachedResource<T>(
  key: string,
  loader: () => Promise<T>,
  options?: number | CachedResourceOptions<T>,
): Promise<T> {
  const { ttlMs, staleTtlMs, onStaleUpdate } = normalizeOptions(options);
  const now = Date.now();
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (existing?.value !== undefined && now - existing.updatedAt < ttlMs) {
    return Promise.resolve(existing.value);
  }
  if (existing?.promise) return existing.promise;
  if (
    existing?.value !== undefined &&
    staleTtlMs !== undefined &&
    now - existing.updatedAt < staleTtlMs
  ) {
    const staleEntry = existing;
    staleEntry.promise = loader()
      .then((value) => {
        staleEntry.value = value;
        staleEntry.updatedAt = Date.now();
        staleEntry.promise = null;
        onStaleUpdate?.(value);
        return value;
      })
      .catch(() => {
        staleEntry.promise = null;
        return staleEntry.value as T;
      });
    return Promise.resolve(existing.value);
  }

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

export function primeCachedResource<T>(key: string, value: T): void {
  cache.set(key, {
    promise: null,
    updatedAt: Date.now(),
    value,
  });
}

export function mutateCachedResource<T>(
  key: string,
  updater: (value: T | undefined) => T,
): T {
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  const value = updater(existing?.value);
  cache.set(key, {
    promise: null,
    updatedAt: Date.now(),
    value,
  });
  return value;
}

export function invalidateCachedResource(key: string): void {
  cache.delete(key);
}

export function invalidateCachedResourcePrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function clearCachedResources(): void {
  cache.clear();
}
