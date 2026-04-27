import type { NextRequest } from "next/server";

import {
  COMPONENT_NAMES,
  readComponent,
  SITE_COMPONENT_DEFINITIONS,
} from "@/lib/components/store";
import { summarizeComponentEntries } from "@/lib/components/parse";
import { loadComponentUsageMap } from "@/lib/components/usage-server";
import {
  apiPayloadOk,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-components-list" };

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      const usage = await loadComponentUsageMap();
      const summaries = Object.fromEntries(
        await Promise.all(
          COMPONENT_NAMES.map(async (name) => {
            const detail = await readComponent(name);
            return [
              name,
              detail
                ? summarizeComponentEntries(name, detail.source)
                : { count: 0, entryLabel: "Entry", rows: [] },
            ];
          }),
        ),
      );

      return apiPayloadOk({
        components: SITE_COMPONENT_DEFINITIONS,
        usage,
        summaries,
      });
    },
    { rateLimit: RATE_LIMIT },
  );
}
