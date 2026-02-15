import type { NextRequest } from "next/server";

import {
  apiExhaustive,
  apiOk,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdmin,
} from "@/lib/server/site-admin-api";
import {
  createSiteNavRow,
  loadSiteAdminConfigData,
  updateSiteNavRow,
  updateSiteSettingsRow,
} from "@/lib/server/site-admin-config-service";
import { parseSiteAdminConfigCommand } from "@/lib/server/site-admin-request";
import type {
  SiteAdminConfigGetPayload,
  SiteAdminConfigPostPayload,
} from "@/lib/site-admin/api-types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withSiteAdmin(req, async () => {
    const data = await loadSiteAdminConfigData();
    return apiPayloadOk<SiteAdminConfigGetPayload>(data);
  });
}

export async function POST(req: NextRequest) {
  return withSiteAdmin(req, async () => {
    const parsedCommand = await readSiteAdminJsonCommand(req, parseSiteAdminConfigCommand);
    if (!parsedCommand.ok) return parsedCommand.res;
    const command = parsedCommand.value;

    switch (command.kind) {
      case "settings":
        await updateSiteSettingsRow(command.rowId, command.patch);
        return apiOk();
      case "nav-update":
        await updateSiteNavRow(command.rowId, command.patch);
        return apiOk();
      case "nav-create": {
        const created = await createSiteNavRow(command.input);
        return apiPayloadOk<SiteAdminConfigPostPayload>({ created });
      }
      default:
        return apiExhaustive(command, "Unknown kind");
    }
  });
}
