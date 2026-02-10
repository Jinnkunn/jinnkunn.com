"use client";

import type { RouteManifestItem } from "@/lib/routes-manifest";
import { parseAdminRoutesPayload, type AdminConfig } from "@/lib/site-admin/route-explorer-model";

export async function fetchAdminConfig(items: RouteManifestItem[]): Promise<AdminConfig> {
  const res = await fetch("/api/site-admin/routes", { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return parseAdminRoutesPayload(data, items);
}

export async function postOverride(input: { pageId: string; routePath: string }) {
  const res = await fetch("/api/site-admin/routes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "override",
      pageId: input.pageId,
      routePath: input.routePath.trim(),
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
}

export async function postAccess(input: {
  pageId: string;
  path: string;
  access: "public" | "password" | "github";
  password?: string;
}) {
  const res = await fetch("/api/site-admin/routes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "protected",
      pageId: input.pageId,
      path: input.path,
      auth: input.access,
      password: String(input.password || "").trim(),
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
}

