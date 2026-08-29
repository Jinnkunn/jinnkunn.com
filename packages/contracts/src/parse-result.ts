export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number };
