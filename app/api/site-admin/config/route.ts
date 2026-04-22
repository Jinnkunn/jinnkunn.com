import type { NextRequest } from "next/server";

import {
  apiExhaustive,
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
} from "@/lib/site-admin/api-types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withSiteAdmin(req, async () => {
    const data = await loadSiteAdminConfigData();
    return apiPayloadOk<Omit<SiteAdminConfigGetPayload, "ok">>(data);
  });
}

export async function POST(req: NextRequest) {
  return withSiteAdmin(req, async () => {
    const parsedCommand = await readSiteAdminJsonCommand(req, parseSiteAdminConfigCommand);
    if (!parsedCommand.ok) return parsedCommand.res;
    const command = parsedCommand.value;

    switch (command.kind) {
      case "settings":
        return apiPayloadOk(await updateSiteSettingsRow(
          command.rowId,
          command.expectedSiteConfigSha,
          command.patch,
        ));
      case "nav-update":
        return apiPayloadOk(await updateSiteNavRow(
          command.rowId,
          command.expectedSiteConfigSha,
          command.patch,
        ));
      case "nav-create": {
        return apiPayloadOk(await createSiteNavRow(command.expectedSiteConfigSha, command.input));
      }
      default:
        return apiExhaustive(command, "Unknown kind");
    }
  });
}
