import { compactId, normalizeRoutePath } from "../shared/route-utils.ts";
import type { ParseResult } from "./request-types.ts";

export type SiteAdminRoutesCommand =
  | { kind: "override"; pageId: string; routePath: string }
  | {
      kind: "protected";
      pageId: string;
      path: string;
      authKind: "public" | "password" | "github";
      password: string;
    };

function bad(error: string, status = 400): ParseResult<never> {
  return { ok: false, error, status };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(
  value: Record<string, unknown>,
  key: string,
  opts?: { trim?: boolean; maxLen?: number },
): string {
  const raw = value[key];
  const s =
    typeof raw === "string"
      ? raw
      : raw === null || raw === undefined
        ? ""
        : String(raw);
  const out = opts?.trim === false ? s : s.trim();
  if (opts?.maxLen && out.length > opts.maxLen) return out.slice(0, opts.maxLen);
  return out;
}

function readEnum<T extends string>(
  value: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = readString(value, key).toLowerCase();
  for (const option of allowed) {
    if (raw === option) return option;
  }
  return fallback;
}

function normalizeOptionalRoutePath(rawPath: string): string {
  if (!rawPath) return "";
  return normalizeRoutePath(rawPath);
}

export function parseSiteAdminRoutesCommand(
  body: Record<string, unknown>,
): ParseResult<SiteAdminRoutesCommand> {
  if (!isRecord(body)) return bad("Invalid command body", 400);
  const kind = readEnum(body, "kind", ["override", "protected"] as const, "");
  if (!kind) return bad("Unsupported kind", 400);

  if (kind === "override") {
    const pageId = compactId(readString(body, "pageId"));
    if (!pageId) return bad("Missing pageId", 400);
    const routePathInput = readString(body, "routePath", { maxLen: 300 });
    const routePath = normalizeOptionalRoutePath(routePathInput);
    if (routePathInput && !routePath) return bad("Invalid routePath", 400);
    return { ok: true, value: { kind, pageId, routePath } };
  }

  const pageId = compactId(readString(body, "pageId"));
  if (!pageId) return bad("Missing pageId", 400);

  const path = normalizeRoutePath(readString(body, "path", { maxLen: 300 }));
  if (!path) return bad("Missing path", 400);

  const authKind = readEnum(
    body,
    "auth",
    ["public", "password", "github"] as const,
    "password",
  );
  const password = readString(body, "password", { maxLen: 160 });
  if (authKind === "public" && password) {
    return bad("Public auth does not use a password", 400);
  }
  if (authKind === "github" && password) {
    return bad("GitHub auth does not use a password", 400);
  }

  return { ok: true, value: { kind, pageId, path, authKind, password } };
}
