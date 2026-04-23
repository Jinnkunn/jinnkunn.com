import {
  asApiAck,
  readApiErrorCode,
  readApiErrorMessage,
  unwrapApiData,
} from "../client/api-guards.ts";

export function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function toNumberOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function toBooleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export type ApiContractErr = { ok: false; error: string; code: string };

/**
 * All site-admin API contracts share the same "did the server ack the
 * request, and if so, either surface its error shape or hand the
 * payload to a caller-supplied parser" envelope. Centralising it here
 * removes ~10 lines of boilerplate from every `parse*Result` function
 * and keeps the error-code / message defaults consistent.
 *
 * `parseOk` returns `null` when the payload is malformed enough that
 * the whole response should be rejected. Returning the successful
 * result shape on success lets each contract keep its own narrow types.
 */
export function parseApiContract<T>(
  x: unknown,
  parseOk: (payload: unknown) => T | null,
): T | ApiContractErr | null {
  const ack = asApiAck(x);
  if (!ack) return null;
  if (!ack.ok) {
    return {
      ok: false,
      error: readApiErrorMessage(x) || ack.error || "Request failed",
      code: readApiErrorCode(x) || ack.code || "REQUEST_FAILED",
    };
  }
  return parseOk(unwrapApiData(x));
}

