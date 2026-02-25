import { compactId, normalizeRoutePath } from "../shared/route-utils.ts";
import {
  normalizeAccessMode,
  type AccessMode,
} from "../shared/access.ts";
import { z } from "zod";
import type { ParseResult } from "./request-types.ts";

export type SiteAdminRoutesCommand =
  | { kind: "override"; pageId: string; routePath: string }
  | {
      kind: "protected";
      pageId: string;
      path: string;
      authKind: AccessMode;
      password: string;
    };

function bad(error: string, status = 400): ParseResult<never> {
  return { ok: false, error, status };
}

const routesCommandSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("override"),
      pageId: z.unknown().optional(),
      routePath: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("protected"),
      pageId: z.unknown().optional(),
      path: z.unknown().optional(),
      auth: z.unknown().optional(),
      password: z.unknown().optional(),
    })
    .passthrough(),
]);

function readString(
  raw: unknown,
  opts?: { trim?: boolean; maxLen?: number },
): string {
  const s =
    typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
  const out = opts?.trim === false ? s : s.trim();
  if (opts?.maxLen && out.length > opts.maxLen) return out.slice(0, opts.maxLen);
  return out;
}

function normalizeOptionalRoutePath(rawPath: string): string {
  if (!rawPath) return "";
  return normalizeRoutePath(rawPath);
}

export function parseSiteAdminRoutesCommand(
  body: Record<string, unknown>,
): ParseResult<SiteAdminRoutesCommand> {
  const parsedBody = routesCommandSchema.safeParse(body);
  if (!parsedBody.success) return bad("Unsupported kind", 400);
  const command = parsedBody.data;
  const kind = command.kind;

  if (kind === "override") {
    const pageId = compactId(readString(command.pageId));
    if (!pageId) return bad("Missing pageId", 400);
    const routePathInput = readString(command.routePath, { maxLen: 300 });
    const routePath = normalizeOptionalRoutePath(routePathInput);
    if (routePathInput && !routePath) return bad("Invalid routePath", 400);
    return { ok: true, value: { kind, pageId, routePath } };
  }

  const pageId = compactId(readString(command.pageId));
  if (!pageId) return bad("Missing pageId", 400);

  const path = normalizeRoutePath(readString(command.path, { maxLen: 300 }));
  if (!path) return bad("Missing path", 400);

  const authKind = normalizeAccessMode(command.auth, "password");
  const password = readString(command.password, { maxLen: 160 });
  if (authKind === "public" && password) {
    return bad("Public auth does not use a password", 400);
  }
  if (authKind === "github" && password) {
    return bad("GitHub auth does not use a password", 400);
  }

  return { ok: true, value: { kind, pageId, path, authKind, password } };
}
