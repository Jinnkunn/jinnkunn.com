// Native OS notification facade. Wraps `@tauri-apps/plugin-notification`
// so callers don't have to deal with the permission dance — every
// `notify()` call lazy-checks permission, requests it once if needed,
// and then either fires or no-ops. The first notification on a fresh
// install pops the macOS permission prompt; subsequent calls reuse the
// granted state cached by the OS.
//
// Why a wrapper instead of importing the plugin directly:
//   - Centralizes the permission check so it can't drift.
//   - Lets us silently swallow errors (a notification that didn't fire
//     because permission was denied isn't a user-actionable failure).
//   - Gives the test suite + non-Tauri preview build a stub seam: both
//     environments call `notify()` which no-ops if the plugin isn't
//     loaded (e.g. running the workspace UI in a regular browser).

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export interface NotifyOptions {
  title: string;
  /** Body line. macOS shows up to ~3 lines; keep concise. */
  body?: string;
  /** Optional icon path (relative to bundle resources). Defaults to
   * the app icon, which is what the operator expects. */
  icon?: string;
}

let cachedGranted: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  // Cache hit (either branch): once we've asked the OS once, don't
  // ask again — neither granted nor denied changes between sessions
  // without an explicit OS-level setting flip, which the plugin
  // refuses to override anyway.
  if (cachedGranted !== null) return cachedGranted;
  try {
    const current = await isPermissionGranted();
    if (current) {
      cachedGranted = true;
      return true;
    }
    const next = await requestPermission();
    cachedGranted = next === "granted";
    return cachedGranted;
  } catch {
    // Plugin not loaded (browser preview, missing capability, etc.).
    // Persist false so we don't pay the failed call on every notify().
    cachedGranted = false;
    return false;
  }
}

export async function notify(options: NotifyOptions): Promise<void> {
  const granted = await ensurePermission();
  if (!granted) return;
  try {
    sendNotification({ title: options.title, body: options.body, icon: options.icon });
  } catch {
    // sendNotification can throw in non-Tauri contexts; degrade silently.
  }
}
