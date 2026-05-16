import "server-only";

import crypto from "node:crypto";

import type { SiteAdminNowData } from "@/lib/site-admin/api-types";
import {
  NOW_CONTEXT_MAX_LENGTH,
  NOW_LOCATION_MAX_LENGTH,
  NOW_STATUS_MAX_LENGTH,
  NOW_UPDATES_MAX_COUNT,
  emptyNowData,
  normalizeNowData,
} from "@/lib/site-admin/now-normalize";
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";

const NOW_REL_PATH = "content/now.json";

export { normalizeNowData };

type OptionalTextPatch = {
  hasValue: boolean;
  value?: string;
};

function trimToMax(value: string, maxLength: number): string {
  const trimmed = String(value || "").trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength).trim() : trimmed;
}

function applyOptionalText(
  current: string | undefined,
  patch: OptionalTextPatch,
  maxLength: number,
): string | undefined {
  if (!patch.hasValue) return current || undefined;
  return trimToMax(patch.value || "", maxLength) || undefined;
}

function makeUpdateId(text: string, at: string): string {
  const stamp = at.replace(/\D+/g, "").slice(0, 14) || String(Date.now());
  const digest = crypto
    .createHash("sha1")
    .update(`${at}\n${text}`)
    .digest("hex")
    .slice(0, 8);
  return `${stamp}-${digest}`;
}

export async function loadSiteAdminNowData(): Promise<{
  data: SiteAdminNowData;
  sourceVersion: { fileSha: string };
}> {
  const store = getSiteAdminSourceStore();
  const file = await store.readTextFile(NOW_REL_PATH);
  if (!file) {
    return { data: emptyNowData(), sourceVersion: { fileSha: "" } };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    parsed = null;
  }
  return {
    data: normalizeNowData(parsed),
    sourceVersion: { fileSha: file.sha },
  };
}

export async function saveSiteAdminNowData(input: {
  data: SiteAdminNowData;
  expectedFileSha?: string;
}): Promise<{ fileSha: string }> {
  const store = getSiteAdminSourceStore();
  const normalized = normalizeNowData(input.data);
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  const result = await store.writeTextFile({
    relPath: NOW_REL_PATH,
    content,
    expectedSha: input.expectedFileSha,
    message: "chore(site-admin): update content/now.json",
  });
  return { fileSha: result.fileSha };
}

export async function appendSiteAdminNowUpdate(input: {
  text: string;
  context: OptionalTextPatch;
  location: OptionalTextPatch;
  expectedFileSha?: string;
  now?: Date;
}): Promise<{
  data: SiteAdminNowData;
  sourceVersion: { fileSha: string };
}> {
  const current = await loadSiteAdminNowData();
  const text = trimToMax(input.text, NOW_STATUS_MAX_LENGTH);
  const at = (input.now ?? new Date()).toISOString();
  const nextData = normalizeNowData({
    ...current.data,
    current: {
      text,
      context: applyOptionalText(
        current.data.current.context,
        input.context,
        NOW_CONTEXT_MAX_LENGTH,
      ),
      location: applyOptionalText(
        current.data.current.location,
        input.location,
        NOW_LOCATION_MAX_LENGTH,
      ),
      updatedAt: at,
    },
    updates: [
      {
        id: makeUpdateId(text, at),
        text,
        at,
      },
      ...current.data.updates,
    ].slice(0, NOW_UPDATES_MAX_COUNT),
  });
  const sourceVersion = await saveSiteAdminNowData({
    data: nextData,
    expectedFileSha: input.expectedFileSha,
  });
  return { data: nextData, sourceVersion };
}
