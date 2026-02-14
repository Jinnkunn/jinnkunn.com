import "server-only";

import { NextResponse } from "next/server";

type NoStoreInit = { status?: number };

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

export function noStoreBadRequest(
  error = "Bad Request",
  init?: NoStoreInit & { extras?: Record<string, unknown> },
) {
  return noStoreFail(error, {
    status: init?.status ?? 400,
    extras: init?.extras,
  });
}

export function noStoreUnauthorized(
  error = "Unauthorized",
  init?: NoStoreInit & { extras?: Record<string, unknown> },
) {
  return noStoreFail(error, {
    status: init?.status ?? 401,
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
  return noStoreFail(message, { status: init?.status ?? 500 });
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
  init?: NoStoreInit & { fallback?: string; extras?: Record<string, unknown> },
) {
  const message =
    e instanceof Error
      ? e.message
      : typeof e === "string" && e.trim()
        ? e
        : (init?.fallback ?? "Unexpected server error");
  return noStoreFail(message, {
    status: init?.status ?? 500,
    extras: init?.extras,
  });
}
