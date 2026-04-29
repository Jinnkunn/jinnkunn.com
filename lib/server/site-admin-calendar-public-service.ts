import "server-only";

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

export async function saveSiteAdminPublicCalendarData(input: {
  data: PublicCalendarData;
  expectedFileSha?: string;
}): Promise<{ fileSha: string }> {
  const store = getSiteAdminSourceStore();
  const result = await store.writeTextFile({
    relPath: CALENDAR_PUBLIC_REL_PATH,
    content: publicCalendarJson(input.data),
    expectedSha: input.expectedFileSha,
    message: "chore(calendar): update public calendar projection",
  });
  await writePublicCalendarToDb(input.data);
  return { fileSha: result.fileSha };
}
