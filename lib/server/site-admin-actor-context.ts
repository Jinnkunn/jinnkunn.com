// Request-scoped store for the authenticated site-admin login. Lets deep
// helpers (DbContentStore.upsert, audit hooks, …) recover the actor without
// threading it through every signature.
//
// AsyncLocalStorage is provided by node:async_hooks and works on Cloudflare
// Workers when nodejs_compat is on (see wrangler.toml). Outside a request
// (build, scripts, tests) the store is empty and getCurrentSiteAdminActor()
// returns null — callers must tolerate that.
//
// No `server-only` marker so node:test can import this module directly.

import { AsyncLocalStorage } from "node:async_hooks";

const __siteAdminActorAls = new AsyncLocalStorage<string>();

export function runWithSiteAdminActor<T>(
  actor: string | null | undefined,
  fn: () => T,
): T {
  const trimmed = String(actor || "").trim();
  if (!trimmed) return fn();
  return __siteAdminActorAls.run(trimmed, fn);
}

export function getCurrentSiteAdminActor(): string | null {
  const value = __siteAdminActorAls.getStore();
  return value ? value : null;
}
