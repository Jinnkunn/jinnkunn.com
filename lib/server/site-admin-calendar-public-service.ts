import "server-only";

import { revalidatePath } from "next/cache";

import {
  normalizePublicCalendarData,
  publicCalendarJson,
  type PublicCalendarData,
} from "@/lib/shared/public-calendar";
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import { writePublicCalendarToDb } from "@/lib/server/public-calendar-db";

const CALENDAR_PUBLIC_REL_PATH = "content/calendar-public.json";

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

export type SaveSiteAdminPublicCalendarResult = {
  fileSha: string;
  dbStatus: "ok" | "skipped" | "failed";
  dbError?: string;
};

export async function saveSiteAdminPublicCalendarData(input: {
  data: PublicCalendarData;
  expectedFileSha?: string;
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
