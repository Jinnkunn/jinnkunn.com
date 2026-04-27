// Adapter that wraps a Cloudflare D1Database binding into the DbExecutor
// surface consumed by createDbContentStore. Lives next to db-content-store.ts
// so the binding-specific knowledge stays out of the store itself.
//
// D1's `prepare(sql).bind(...).all()` is the canonical query path; this thin
// shim normalizes its result to the `{ rows, rowsAffected }` shape the store
// expects. No `server-only` marker so node:test can import the type.

import type { DbExecutor } from "./db-content-store.ts";

// Structural type — avoids a runtime import of @cloudflare/workers-types.
// Matches the D1 Workers runtime API (https://developers.cloudflare.com/d1/).
export type D1DatabaseLike = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T = Record<string, unknown>>(): Promise<{
        results?: T[];
        meta?: { changes?: number; rows_written?: number };
      }>;
    };
    all<T = Record<string, unknown>>(): Promise<{
      results?: T[];
      meta?: { changes?: number; rows_written?: number };
    }>;
  };
};

// D1's `bind` accepts: null | string | number | ArrayBuffer | boolean.
// `Uint8Array` views need to be unwrapped to a bare ArrayBuffer first.
function toBindable(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    if (
      value.byteOffset === 0 &&
      value.byteLength === value.buffer.byteLength
    ) {
      return value.buffer;
    }
    return value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    );
  }
  return value;
}

export function createD1Executor(db: D1DatabaseLike): DbExecutor {
  return {
    async execute({ sql, args }) {
      const stmt = db.prepare(sql);
      const bound =
        args && args.length > 0 ? stmt.bind(...args.map(toBindable)) : stmt;
      const result = await bound.all<Record<string, unknown>>();
      return {
        rows: result.results ?? [],
        rowsAffected: result.meta?.changes ?? 0,
      };
    },
  };
}
