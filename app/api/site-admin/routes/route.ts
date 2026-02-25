import type { NextRequest } from "next/server";

import {
  apiExhaustive,
  apiOk,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  requireNonEmptyString,
  withSiteAdmin,
} from "@/lib/server/site-admin-api";
import {
  disableOverride,
  disableProtected,
  getAdminDbIds,
  loadSiteAdminRouteData,
  upsertOverride,
  upsertProtected,
} from "@/lib/server/site-admin-routes-service";
import {
  parseSiteAdminRoutesCommand,
} from "@/lib/server/site-admin-request";
import type {
  SiteAdminRoutesGetPayload,
} from "@/lib/site-admin/api-types";

export const runtime = "nodejs";

type SiteAdminRoutesResponsePayload = Omit<SiteAdminRoutesGetPayload, "ok">;

export async function GET(req: NextRequest) {
  return withSiteAdmin(req, async () => {
    const { adminPageId, overridesDbId, protectedDbId, overrides, protectedRoutes } =
      await loadSiteAdminRouteData();

    const payload: SiteAdminRoutesResponsePayload = {
      adminPageId,
      databases: { overridesDbId, protectedDbId },
      overrides,
      protectedRoutes,
    };

    return apiPayloadOk<SiteAdminRoutesResponsePayload>(payload);
  });
}

export async function POST(req: NextRequest) {
  return withSiteAdmin(req, async () => {
    const { overridesDbId, protectedDbId } = await getAdminDbIds();
    const parsedCommand = await readSiteAdminJsonCommand(req, parseSiteAdminRoutesCommand);
    if (!parsedCommand.ok) return parsedCommand.res;
    const command = parsedCommand.value;

    if (command.kind === "override") {
      const validOverridesDbId = requireNonEmptyString(
        overridesDbId,
        "Missing Route Overrides DB",
        500,
      );
      if (!validOverridesDbId.ok) return validOverridesDbId.res;
      const dbId = validOverridesDbId.value;

      if (!command.routePath) {
        await disableOverride({ overridesDbId: dbId, pageId: command.pageId });
        return apiOk();
      }

      const out = await upsertOverride({
        overridesDbId: dbId,
        pageId: command.pageId,
        routePath: command.routePath,
      });
      return apiOk({ override: out });
    }

    if (command.kind === "protected") {
      const validProtectedDbId = requireNonEmptyString(
        protectedDbId,
        "Missing Protected Routes DB",
        500,
      );
      if (!validProtectedDbId.ok) return validProtectedDbId.res;
      const dbId = validProtectedDbId.value;
      // Product decision: protecting a page must protect its subtree (Super-like),
      // so we always store prefix rules.
      const mode = "prefix" as const;

      // Public = disable any protection rule for this page.
      if (command.authKind === "public") {
        await disableProtected({
          protectedDbId: dbId,
          pageId: command.pageId,
          path: command.path,
        });
        return apiOk();
      }

      // Disable password protection if password is blank.
      if (command.authKind === "password" && !command.password) {
        await disableProtected({
          protectedDbId: dbId,
          pageId: command.pageId,
          path: command.path,
        });
        return apiOk();
      }

      const out = await upsertProtected({
        protectedDbId: dbId,
        pageId: command.pageId,
        path: command.path,
        mode,
        password: command.password,
        auth: command.authKind,
      });
      return apiOk({ protected: out });
    }

    return apiExhaustive(command, "Unsupported kind");
  });
}
