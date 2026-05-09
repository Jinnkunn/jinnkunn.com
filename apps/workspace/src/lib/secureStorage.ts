import { secureStoreDelete, secureStoreGet, secureStoreSet } from "./tauri";

// Shared secure-storage layer with per-tool namespacing. Each feature
// module gets its own namespace so keys can't collide — e.g. site-admin's
// "auth-token" lives at `site-admin:auth-token`, calendar's at
// `calendar:auth-token`.
//
// The Rust side (secure_store_* commands) chooses the backend:
// production uses the system keychain, debug builds use workspace.db so
// development/testing does not get interrupted by macOS Keychain prompts.
// Within-app namespacing still matters because the credential backend is
// shared by all first-party modules.

export interface NamespacedSecureStorage {
  namespace: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Pattern: one call per feature module, top-level.
 *
 *   // in src/surfaces/site-admin/api.ts
 *   const storage = createNamespacedSecureStorage("site-admin");
 *   await storage.set("auth-token", token);
 */
export function createNamespacedSecureStorage(
  namespace: string,
): NamespacedSecureStorage {
  const trimmed = namespace.trim();
  if (!trimmed) {
    throw new Error("Secure storage namespace must be non-empty");
  }
  if (trimmed.includes(":")) {
    throw new Error(
      `Secure storage namespace "${trimmed}" must not contain ':' (reserved as separator)`,
    );
  }
  const prefix = `${trimmed}:`;
  return {
    namespace: trimmed,
    get(key) {
      return secureStoreGet(prefix + key);
    },
    set(key, value) {
      return secureStoreSet(prefix + key, value);
    },
    delete(key) {
      return secureStoreDelete(prefix + key);
    },
  };
}
