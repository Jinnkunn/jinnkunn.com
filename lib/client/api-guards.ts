export type ApiOk = { ok: true };
export type ApiError = { ok: false; error: string };
export type ApiAck = ApiOk | ApiError;

export function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

export function readApiErrorMessage(x: unknown): string {
  if (!isRecord(x)) return "";
  const error = x.error;
  return typeof error === "string" && error.trim() ? error : "";
}

export function isApiOk(x: unknown): x is ApiOk {
  return isRecord(x) && x.ok === true;
}

export function asApiAck(x: unknown, fallbackError = "Request failed"): ApiAck | null {
  if (!isRecord(x) || typeof x.ok !== "boolean") return null;
  if (x.ok === true) return { ok: true };
  return {
    ok: false,
    error: readApiErrorMessage(x) || fallbackError,
  };
}
