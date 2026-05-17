import "server-only";

import { listPages } from "@/lib/pages/store";
import { listPosts } from "@/lib/posts/store";
import {
  buildSiteAdminMobileSummary,
  type SiteAdminMobileSummary,
} from "@/lib/site-admin/mobile-summary";
import { loadSiteAdminPublicCalendarData } from "@/lib/server/site-admin-calendar-public-service";
import { getSiteAdminStatusBackend } from "@/lib/server/site-admin-backend-service";
import { loadSiteAdminNowData } from "@/lib/server/site-admin-now-service";
import {
  getReleaseRunnerStatus,
  listReleaseJobs,
} from "@/lib/server/release-jobs-service";

export async function getSiteAdminMobileSummary(): Promise<SiteAdminMobileSummary> {
  const [statusOut, nowOut, calendarOut, jobsOut, runnersOut, postsOut, pagesOut] =
    await Promise.allSettled([
      getSiteAdminStatusBackend(),
      loadSiteAdminNowData(),
      loadSiteAdminPublicCalendarData(),
      listReleaseJobs({ limit: 5 }),
      getReleaseRunnerStatus({ limit: 4 }),
      listPosts({ includeDrafts: true }),
      listPages({ includeDrafts: true }),
    ]);

  const status =
    statusOut.status === "fulfilled" && statusOut.value.ok
      ? statusOut.value.data
      : null;
  const now =
    nowOut.status === "fulfilled" ? nowOut.value.data : null;
  const calendar =
    calendarOut.status === "fulfilled" ? calendarOut.value.data : null;
  const jobs =
    jobsOut.status === "fulfilled" && jobsOut.value.ok ? jobsOut.value.data.jobs : [];
  const runners =
    runnersOut.status === "fulfilled" && runnersOut.value.ok
      ? runnersOut.value.data.agents
      : [];
  const posts = postsOut.status === "fulfilled" ? postsOut.value.length : 0;
  const pages = pagesOut.status === "fulfilled" ? pagesOut.value.length : 0;

  return buildSiteAdminMobileSummary({
    calendar: calendar
      ? {
          eventCount: calendar.events.length,
          generatedAt: calendar.generatedAt,
          rangeStartsAt: calendar.range.startsAt,
          rangeEndsAt: calendar.range.endsAt,
        }
      : undefined,
    content: { posts, pages },
    generatedAt: new Date().toISOString(),
    jobs,
    now,
    runners,
    status,
  });
}
