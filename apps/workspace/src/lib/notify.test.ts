import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the plugin BEFORE importing the module under test so the
// `import` in notify.ts binds to the mock, not the real plugin.
const isPermissionGranted = vi.fn();
const requestPermission = vi.fn();
const sendNotification = vi.fn();

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => isPermissionGranted(),
  requestPermission: () => requestPermission(),
  sendNotification: (opts: unknown) => sendNotification(opts),
}));

// `notify` caches the granted result via a module-level variable. We
// re-import the module fresh for each test to reset that cache, so a
// "denied" outcome in one test doesn't poison the next.
async function freshNotify() {
  vi.resetModules();
  const mod = await import("./notify");
  return mod.notify;
}

describe("lib/notify", () => {
  beforeEach(() => {
    isPermissionGranted.mockReset();
    requestPermission.mockReset();
    sendNotification.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests permission once when not granted, then sends", async () => {
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("granted");
    sendNotification.mockReturnValue(undefined);
    const notify = await freshNotify();

    await notify({ title: "Hello", body: "world" });
    await notify({ title: "Again" });

    expect(isPermissionGranted).toHaveBeenCalledOnce();
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sendNotification).toHaveBeenNthCalledWith(1, {
      title: "Hello",
      body: "world",
      icon: undefined,
    });
  });

  it("skips sendNotification entirely when permission is denied", async () => {
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("denied");
    const notify = await freshNotify();

    await notify({ title: "x" });
    await notify({ title: "y" });

    // Cached "denied" — the second call must not even ask again.
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("skips the permission round-trip when already granted", async () => {
    isPermissionGranted.mockResolvedValue(true);
    sendNotification.mockReturnValue(undefined);
    const notify = await freshNotify();

    await notify({ title: "x" });
    await notify({ title: "y" });
    await notify({ title: "z" });

    // Once for the first call (cached after); requestPermission never.
    expect(isPermissionGranted).toHaveBeenCalledOnce();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(sendNotification).toHaveBeenCalledTimes(3);
  });

  it("swallows plugin errors so a failed notification never crashes the caller", async () => {
    isPermissionGranted.mockRejectedValue(new Error("plugin not loaded"));
    const notify = await freshNotify();
    // Must resolve, not throw, so the operator's save/promote flow
    // doesn't get a popup error from a missing plugin in a non-Tauri
    // preview build.
    await expect(notify({ title: "x" })).resolves.toBeUndefined();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
