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
