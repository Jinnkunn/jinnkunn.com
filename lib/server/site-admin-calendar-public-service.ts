import "server-only";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  normalizePublicCalendarData,
  publicCalendarJson,
  type PublicCalendarData,
} from "@jinnkunn/calendar-core/public";
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import {
  readPublicCalendarFromDb,
  writePublicCalendarToDb,
} from "@/lib/server/public-calendar-db";

const CALENDAR_PUBLIC_REL_PATH = "content/calendar-public.json";

/** Optimistic-lock token for a calendar projection: sha1 over the exact JSON
 * we persist. Matches the source store's file sha for the same data, so the
 * file-backed and live endpoints speak one version vocabulary. */
export function publicCalendarSha(data: PublicCalendarData): string {
  return createHash("sha1").update(publicCalendarJson(data), "utf8").digest("hex");
}

export async function loadSiteAdminPublicCalendarData(): Promise<{
  data: PublicCalendarData;
  sourceVersion: { fileSha: string };
}> {
  const store = getSiteAdminSourceStore();
  const file = await store.readTextFile(CALENDAR_PUBLIC_REL_PATH);
  if (!file) {
    return {
      data: normalizePublicCalendarData(null),
      sourceVersion: { fileSha: "" },
    };
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    parsed = null;
  }

  return {
    data: normalizePublicCalendarData(parsed),
    sourceVersion: { fileSha: file.sha },
  };
}

/** Current version of the *live* (D1) projection. `/calendar-public/live`
 * writes straight to the production database without touching the JSON file,
 * so its conflict check has to hash the rows that are actually published.
 * An empty `fileSha` means nothing is published yet (or D1 isn't bound) —
 * that's the token a first writer must send. */
export async function loadLiveSiteAdminPublicCalendarData(): Promise<{
  data: PublicCalendarData | null;
  sourceVersion: { fileSha: string };
}> {
  const data = await readPublicCalendarFromDb();
  return {
    data,
    sourceVersion: { fileSha: data ? publicCalendarSha(data) : "" },
  };
}

export type SaveSiteAdminPublicCalendarResult = {
  fileSha: string;
  dbStatus: "ok" | "skipped" | "failed";
  dbError?: string;
};

// `expectedFileSha` is required (empty string = "expect no file yet"): the
// calendar is edited from two clients, and an unconditional write let the
// slower one silently clobber the faster one.
export async function saveSiteAdminPublicCalendarData(input: {
  data: PublicCalendarData;
  expectedFileSha: string;
}): Promise<SaveSiteAdminPublicCalendarResult> {
  const store = getSiteAdminSourceStore();
  const result = await store.writeTextFile({
    relPath: CALENDAR_PUBLIC_REL_PATH,
    content: publicCalendarJson(input.data),
    expectedSha: input.expectedFileSha,
    message: "chore(calendar): update public calendar projection",
  });
  const dbResult = await writePublicCalendarToDb(input.data);
  try {
    revalidatePath("/calendar");
    revalidatePath("/api/public/calendar");
  } catch {
    // Outside a request scope (test harness, etc.) the cache APIs throw —
    // ignore: the public route also caps cache age at 30s, so visitors
    // see fresh data within the next refresh.
  }
  if (!dbResult.ok) {
    return {
      fileSha: result.fileSha,
      dbStatus: "failed",
      dbError: dbResult.error,
    };
  }
  return {
    fileSha: result.fileSha,
    dbStatus: dbResult.skipped ? "skipped" : "ok",
  };
}
