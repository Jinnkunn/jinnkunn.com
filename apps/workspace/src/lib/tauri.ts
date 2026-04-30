import { invoke } from "@tauri-apps/api/core";

/** Macos traffic-light inset tuner (no-op on other platforms). Dev helper
 * for finding the exact (x, y) that visually centers the lights inside
 * the workspace titlebar. */
export function debugSetTrafficLights(x: number, y: number): Promise<void> {
  return invoke("debug_set_traffic_lights", { x, y });
}

/** Open an http(s) URL in the user's default browser. The Tauri webview
 * doesn't honour `<a target="_blank">` on its own; this routes through
 * the Rust `open` crate so external links land in Safari / Chrome /
 * Firefox the way the operator expects. */
export function openExternalUrl(url: string): Promise<void> {
  return invoke("open_external_url", { url });
}

/** Raw keyring access — prefer `createNamespacedSecureStorage` so modules
 * don't collide on key names. */
export function secureStoreSet(key: string, value: string): Promise<void> {
  return invoke("secure_store_set", { key, value });
}

export function secureStoreGet(key: string): Promise<string | null> {
  return invoke("secure_store_get", { key });
}

export function secureStoreDelete(key: string): Promise<void> {
  return invoke("secure_store_delete", { key });
}
