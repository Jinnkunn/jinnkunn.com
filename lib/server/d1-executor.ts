// Adapter that wraps a Cloudflare D1Database binding into the DbExecutor
// surface consumed by createDbContentStore. Lives next to db-content-store.ts
// so the binding-specific knowledge stays out of the store itself.
//
// D1's `prepare(sql).bind(...).all()` is the canonical query path; this thin
// shim normalizes its result to the `{ rows, rowsAffected }` shape the store
// expects. No `server-only` marker so node:test can import the type.

import type {
  DbResult,
  DbStatement,
  TransactionalDbExecutor,
} from "./db-content-store.ts";

type D1ResultLike<T> = {
  results?: T[];
  success?: boolean;
  error?: string;
  meta?: { changes?: number };
};

type D1StatementLike = {
  bind(...values: unknown[]): D1StatementLike;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
};

// Structural type — avoids a runtime import of @cloudflare/workers-types.
// Matches the D1 Workers runtime API (https://developers.cloudflare.com/d1/).
export type D1DatabaseLike = {
  prepare(query: string): D1StatementLike;
  batch?<T = Record<string, unknown>>(
    statements: D1StatementLike[],
  ): Promise<D1ResultLike<T>[]>;
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

function toDbResult(result: D1ResultLike<Record<string, unknown>>): DbResult {
  if (result.success === false) throw new Error(result.error ?? "D1 query failed.");
  return {
    rows: result.results ?? [],
    rowsAffected: result.meta?.changes ?? 0,
  };
}

export function createD1Executor(db: D1DatabaseLike): TransactionalDbExecutor {
  const prepare = ({ sql, args }: DbStatement) => {
    const stmt = db.prepare(sql);
    return args?.length ? stmt.bind(...args.map(toBindable)) : stmt;
  };
  return {
    async execute(statement) {
      return toDbResult(await prepare(statement).all());
    },
    async batch(statements) {
      if (!statements.length) return [];
      if (!db.batch) throw new Error("D1 transactional batching is not available.");
      const results = await db.batch(statements.map(prepare));
      if (results.length !== statements.length) {
        throw new Error("D1 returned an incomplete batch result.");
      }
      return results.map(toDbResult);
    },
  };
}
