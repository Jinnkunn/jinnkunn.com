import "server-only";

import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { apiError } from "@/lib/server/site-admin-api";

function readBearerToken(req: NextRequest): string {
  const raw = String(req.headers.get("authorization") || "").trim();
  if (!raw) return "";
  const [scheme, ...rest] = raw.split(/\s+/);
  if (scheme.toLowerCase() !== "bearer") return "";
  return rest.join(" ").trim();
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function requireReleaseAgent(req: NextRequest):
  | { ok: true; agentId: string }
  | { ok: false; res: ReturnType<typeof apiError> } {
  const expected = String(process.env.SITE_ADMIN_RELEASE_AGENT_TOKEN || "").trim();
  if (!expected) {
    return {
      ok: false,
      res: apiError("Release agent token is not configured.", {
        status: 503,
        code: "RELEASE_AGENT_TOKEN_MISSING",
      }),
    };
  }
  const token = readBearerToken(req);
  if (!token || !timingSafeStringEqual(token, expected)) {
    return {
      ok: false,
      res: apiError("Unauthorized", { status: 401, code: "UNAUTHORIZED" }),
    };
  }
  const agentId =
    String(req.headers.get("x-release-agent-id") || "").trim().slice(0, 120) ||
    "release-agent";
  return { ok: true, agentId };
}

