import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cachedResource,
  clearCachedResources,
  mutateCachedResource,
  primeCachedResource,
} from "./resourceCache";

describe("resourceCache", () => {
  afterEach(() => {
    vi.useRealTimers();
    clearCachedResources();
  });

  it("returns fresh cached values within ttl", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const loader = vi.fn(async () => "first");

    await expect(cachedResource("a", loader, 100)).resolves.toBe("first");
    vi.setSystemTime(1050);
    await expect(cachedResource("a", loader, 100)).resolves.toBe("first");

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("returns stale values immediately while refreshing in the background", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    primeCachedResource("a", "stale");
    vi.setSystemTime(2000);
    const onStaleUpdate = vi.fn();

    await expect(
      cachedResource("a", async () => "fresh", {
        ttlMs: 100,
        staleTtlMs: 5_000,
        onStaleUpdate,
      }),
    ).resolves.toBe("stale");
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(onStaleUpdate).toHaveBeenCalledWith("fresh");
    await expect(cachedResource("a", async () => "next", 5_000)).resolves.toBe(
      "fresh",
    );
  });

  it("supports optimistic cache mutation", () => {
    primeCachedResource("items", ["a"]);

    const next = mutateCachedResource<string[]>("items", (current) => [
      ...(current ?? []),
      "b",
    ]);

    expect(next).toEqual(["a", "b"]);
  });

  it("does not keep a stale in-flight read after optimistic mutation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    let resolvePending: (value: string[]) => void = () => {};
    const pendingRead = cachedResource(
      "items",
      () =>
        new Promise<string[]>((resolve) => {
          resolvePending = resolve;
        }),
      100,
    );

    mutateCachedResource<string[]>("items", (current) => [
      ...(current ?? []),
      "optimistic",
    ]);

    vi.setSystemTime(2000);
    const loader = vi.fn(async () => ["server-new"]);
    const refreshed = cachedResource("items", loader, 100);
    resolvePending(["server-old"]);

    await expect(pendingRead).resolves.toEqual(["server-old"]);
    await expect(refreshed).resolves.toEqual(["server-new"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
