import "server-only";

import { NextResponse } from "next/server";

type NoStoreInit = { status?: number };
type NoStoreErrorInit = NoStoreInit & { fallback?: string; extras?: Record<string, unknown> };
type NoStoreCodeErrorInit = NoStoreInit & { code?: string; extras?: Record<string, unknown> };

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

function normalizeErrorCode(value: string | undefined, fallback: string): string {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return raw.replace(/[^A-Za-z0-9_]+/g, "_").toUpperCase();
}

export function noStoreJson<T>(
  body: T,
  init?: NoStoreInit,
): NextResponse<T> {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: { "cache-control": "no-store" },
  });
}

export function noStoreOk<T extends Record<string, unknown> = Record<string, never>>(
  payload?: T,
  init?: NoStoreInit,
) {
  const body = payload ? ({ ok: true, ...payload } as const) : ({ ok: true } as const);
  return noStoreJson(body, init);
}

export function noStoreData<T>(
  data: T,
  init?: NoStoreInit,
): NextResponse<ApiResponse<T>> {
  return noStoreJson({ ok: true, data }, init);
}

export function noStoreFail(
  error: string,
  init?: NoStoreInit & { extras?: Record<string, unknown> },
) {
  const body = {
    ok: false,
    error: String(error || "Request failed"),
    ...(init?.extras || {}),
  };
  return noStoreJson(body, { status: init?.status ?? 400 });
}

export function noStoreFailWithCode(
  error: string,
  init?: NoStoreCodeErrorInit,
): NextResponse<ApiResponse<never>> {
  const body = {
    ok: false as const,
    error: String(error || "Request failed"),
    code: normalizeErrorCode(init?.code, "REQUEST_FAILED"),
    ...(init?.extras || {}),
  };
  return noStoreJson(body, { status: init?.status ?? 400 });
}

export function noStoreBadRequest(
  error = "Bad Request",
  init?: NoStoreCodeErrorInit,
) {
  return noStoreFailWithCode(error, {
    status: init?.status ?? 400,
    code: init?.code ?? "BAD_REQUEST",
    extras: init?.extras,
  });
}

export function noStoreUnauthorized(
  error = "Unauthorized",
  init?: NoStoreCodeErrorInit,
) {
  return noStoreFailWithCode(error, {
    status: init?.status ?? 401,
    code: init?.code ?? "UNAUTHORIZED",
    extras: init?.extras,
  });
}

export function noStoreMethodNotAllowed(
  allow?: string[] | string,
  error = "Method Not Allowed",
) {
  const allowList = Array.isArray(allow) ? allow : allow ? [allow] : [];
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (allowList.length) headers.allow = allowList.join(", ");
  return NextResponse.json(
    {
      ok: false,
      error,
    },
    {
      status: 405,
      headers,
    },
  );
}

export function noStoreMisconfigured(
  missing: string | string[],
  init?: Omit<NoStoreInit, "status"> & { status?: number },
) {
  const keys = Array.isArray(missing) ? missing : [missing];
  const cleaned = keys.map((k) => String(k || "").trim()).filter(Boolean);
  const suffix = cleaned.join(", ");
  const message = suffix
    ? `Server misconfigured: missing ${suffix}`
    : "Server misconfigured";
  return noStoreFailWithCode(message, { status: init?.status ?? 500, code: "MISCONFIGURED" });
}

export function noStoreErrorOnly(
  error: string,
  init?: NoStoreInit & { extras?: Record<string, unknown> },
) {
  const body = {
    error: String(error || "Request failed"),
    ...(init?.extras || {}),
  };
  return noStoreJson(body, { status: init?.status ?? 400 });
}

export function noStoreFailFromUnknown(
  e: unknown,
  init?: NoStoreErrorInit & { code?: string },
) {
  const message =
    e instanceof Error
      ? e.message
      : typeof e === "string" && e.trim()
        ? e
        : (init?.fallback ?? "Unexpected server error");
  return noStoreFailWithCode(message, {
    status: init?.status ?? 500,
    code: init?.code ?? "INTERNAL_ERROR",
    extras: init?.extras,
  });
}

export async function withNoStoreApi(
  run: () => Promise<Response> | Response,
  init?: NoStoreErrorInit & { code?: string },
): Promise<Response> {
  try {
    return await run();
  } catch (e: unknown) {
    return noStoreFailFromUnknown(e, init);
  }
}

export function trimErrorDetail(text: string, maxLen = 200): string {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.slice(0, Math.max(1, maxLen));
}

export function formatDeployTriggerError(
  status: number,
  attempts: number,
  detail: string,
): string {
  const suffix = detail ? `: ${detail}` : "";
  return `Failed to trigger deploy (status ${status}, attempts ${attempts})${suffix}`;
}
