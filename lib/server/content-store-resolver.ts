// Picks the correct ContentStore backend based on `SITE_ADMIN_STORAGE`.
// Kept in a separate file so `lib/server/content-store.ts` stays dependency-free
// and doesn't pull in the D1 client when it's not needed.
// No `server-only` marker so node:test can import this module directly.

import path from "node:path";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { DocumentRepository } from "@jinnkunn/document-repository";

import {
  contentStoreFromDocumentRepository,
  type ContentStore,
} from "./content-store.ts";
import {
  createDbDocumentRepository,
  type DbExecutor,
} from "./db-content-store.ts";
import { createD1Executor, type D1DatabaseLike } from "./d1-executor.ts";
import { createLocalDocumentRepository } from "./document-repository-local.ts";
import { getCurrentSiteAdminActor } from "./site-admin-actor-context.ts";

function isD1Like(value: unknown): value is D1DatabaseLike {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { prepare?: unknown }).prepare === "function"
  );
}

function tryGetD1Executor(): DbExecutor | null {
  // getCloudflareContext throws outside a request lifecycle (e.g. during
  // build, in scripts). Fall back to local in those cases so build-time
  // route handlers can read the content/ snapshot dumped by prebuild.
  try {
    const { env } = getCloudflareContext();
    const binding = (env as Record<string, unknown>).SITE_ADMIN_DB;
    return isD1Like(binding) ? createD1Executor(binding) : null;
  } catch {
    return null;
  }
}

function createDefaultLocalDocumentRepository(): DocumentRepository {
  return createLocalDocumentRepository({
    rootDir: path.join(process.cwd(), "content"),
    gitRootDir: process.cwd(),
    gitPathPrefix: "content",
  });
}

export function getDocumentRepository(): DocumentRepository {
  const kind = String(process.env.SITE_ADMIN_STORAGE || "local").trim().toLowerCase();
  if (kind === "db") {
    const executor = tryGetD1Executor();
    if (executor) {
      return createDbDocumentRepository({
        executor,
        getActor: getCurrentSiteAdminActor,
      });
    }
    // No D1 binding (build, dev without wrangler, missing config) → local.
    return createDefaultLocalDocumentRepository();
  }
  if (kind === "local" || !kind) return createDefaultLocalDocumentRepository();
  throw new Error(`Unsupported SITE_ADMIN_STORAGE: ${kind}`);
}

export function getContentStore(): ContentStore {
  return contentStoreFromDocumentRepository(getDocumentRepository());
}
