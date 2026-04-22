import type { NextRequest } from "next/server";

import {
  apiExhaustive,
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
import { resolveContentSourceKind } from "@/lib/shared/content-source";

export const runtime = "nodejs";

type SiteAdminRoutesResponsePayload = Omit<SiteAdminRoutesGetPayload, "ok">;

export async function GET(req: NextRequest) {
  return withSiteAdmin(req, async () => {
    const { adminPageId, overridesDbId, protectedDbId, overrides, protectedRoutes, sourceVersion } =
      await loadSiteAdminRouteData();

    const payload: SiteAdminRoutesResponsePayload = {
      adminPageId,
      sourceVersion,
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
    const source = resolveContentSourceKind();
    const parsedCommand = await readSiteAdminJsonCommand(req, parseSiteAdminRoutesCommand);
    if (!parsedCommand.ok) return parsedCommand.res;
    const command = parsedCommand.value;

    if (command.kind === "override") {
      let dbId = "";
      if (source !== "filesystem") {
        const validOverridesDbId = requireNonEmptyString(
          overridesDbId,
          "Missing Route Overrides DB",
          500,
        );
        if (!validOverridesDbId.ok) return validOverridesDbId.res;
        dbId = validOverridesDbId.value;
      }

      if (!command.routePath) {
        return apiPayloadOk(await disableOverride({
          expectedSiteConfigSha: command.expectedSiteConfigSha,
          overridesDbId: dbId,
          pageId: command.pageId,
        }));
      }

      return apiPayloadOk(await upsertOverride({
        expectedSiteConfigSha: command.expectedSiteConfigSha,
        overridesDbId: dbId,
        pageId: command.pageId,
        routePath: command.routePath,
      }));
    }

    if (command.kind === "protected") {
      let dbId = "";
      if (source !== "filesystem") {
        const validProtectedDbId = requireNonEmptyString(
          protectedDbId,
          "Missing Protected Routes DB",
          500,
        );
        if (!validProtectedDbId.ok) return validProtectedDbId.res;
        dbId = validProtectedDbId.value;
      }
      // Product decision: protecting a page must protect its subtree (Super-like),
      // so we always store prefix rules.
      const mode = "prefix" as const;

      // Public = disable any protection rule for this page.
      if (command.authKind === "public") {
        return apiPayloadOk(await disableProtected({
          expectedProtectedRoutesSha: command.expectedProtectedRoutesSha,
          protectedDbId: dbId,
          pageId: command.pageId,
          path: command.path,
        }));
      }

      // Disable password protection if password is blank.
      if (command.authKind === "password" && !command.password) {
        return apiPayloadOk(await disableProtected({
          expectedProtectedRoutesSha: command.expectedProtectedRoutesSha,
          protectedDbId: dbId,
          pageId: command.pageId,
          path: command.path,
        }));
      }

      return apiPayloadOk(await upsertProtected({
        expectedProtectedRoutesSha: command.expectedProtectedRoutesSha,
        protectedDbId: dbId,
        pageId: command.pageId,
        path: command.path,
        mode,
        password: command.password,
        auth: command.authKind,
      }));
    }

    return apiExhaustive(command, "Unsupported kind");
  });
}
