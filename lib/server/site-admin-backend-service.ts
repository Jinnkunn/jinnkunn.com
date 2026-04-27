import "server-only";

import { formatDeployTriggerError, trimErrorDetail } from "@/lib/server/api-response";
import {
  createSiteNavRow,
  loadSiteAdminConfigData,
  updateSiteNavRow,
  updateSiteSettingsRow,
} from "@/lib/server/site-admin-config-service";
import { buildSiteAdminDeployPreviewPayload } from "@/lib/server/site-admin-deploy-preview-service";
import {
  disableOverride,
  disableProtected,
  loadSiteAdminRouteData,
  upsertOverride,
  upsertProtected,
} from "@/lib/server/site-admin-routes-service";
import { buildSiteAdminStatusPayload } from "@/lib/server/site-admin-status-service";
import {
  getSiteAdminSourceStore,
  isSiteAdminSourceConflictError,
} from "@/lib/server/site-admin-source-store";
import { triggerDeployHook } from "@/lib/server/deploy-hook";
import {
  buildDeployMetadataMessage,
  pickRuntimeCodeSha,
} from "@/lib/server/deploy-metadata";
import type {
  SiteAdminConfigGetPayload,
  SiteAdminConfigPostPayload,
  SiteAdminDeployPayload,
  SiteAdminDeployPreviewPayload,
  SiteAdminRoutesGetPayload,
  SiteAdminRoutesPostPayload,
  SiteAdminStatusPayload,
} from "@/lib/site-admin/api-types";
import type { SiteAdminConfigCommand } from "@/lib/server/site-admin-request";
import type { SiteAdminRoutesCommand } from "@/lib/site-admin/routes-command";

type SiteAdminBackendError = {
  ok: false;
  status: number;
  code: string;
  error: string;
};

type SiteAdminBackendOk<T extends Record<string, unknown>> = {
  ok: true;
  data: T;
};

export type SiteAdminBackendResult<T extends Record<string, unknown>> =
  | SiteAdminBackendOk<T>
  | SiteAdminBackendError;

function backendOk<T extends Record<string, unknown>>(data: T): SiteAdminBackendOk<T> {
  return { ok: true, data };
}

function backendError(error: string, status: number, code: string): SiteAdminBackendError {
  return { ok: false, error, status, code };
}

function toBackendResultFromUnknown(err: unknown): SiteAdminBackendError {
  if (isSiteAdminSourceConflictError(err)) {
    return backendError(err.message, 409, err.code);
  }
  return backendError(err instanceof Error ? err.message : String(err), 500, "REQUEST_FAILED");
}

export async function getSiteAdminConfigBackend():
  Promise<SiteAdminBackendResult<Omit<SiteAdminConfigGetPayload, "ok">>> {
  try {
    const data = await loadSiteAdminConfigData();
    return backendOk(data);
  } catch (err: unknown) {
    return toBackendResultFromUnknown(err);
  }
}

export async function postSiteAdminConfigBackend(
  command: SiteAdminConfigCommand,
): Promise<SiteAdminBackendResult<Omit<SiteAdminConfigPostPayload, "ok">>> {
  try {
    switch (command.kind) {
      case "settings":
        return backendOk({
          sourceVersion: await updateSiteSettingsRow(
            command.rowId,
            command.patch,
            command.expectedSiteConfigSha,
          ),
        });
      case "nav-update":
        return backendOk({
          sourceVersion: await updateSiteNavRow(
            command.rowId,
            command.patch,
            command.expectedSiteConfigSha,
          ),
        });
      case "nav-create": {
        const { created, sourceVersion } = await createSiteNavRow(
          command.input,
          command.expectedSiteConfigSha,
        );
        return backendOk({ created, sourceVersion });
      }
      default:
        return backendError("Unsupported request", 400, "UNSUPPORTED_REQUEST");
    }
  } catch (err: unknown) {
    return toBackendResultFromUnknown(err);
  }
}

export async function getSiteAdminRoutesBackend():
  Promise<SiteAdminBackendResult<Omit<SiteAdminRoutesGetPayload, "ok">>> {
  try {
    const {
      adminPageId,
      databases,
      overrides,
      protectedRoutes,
      sourceVersion,
    } = await loadSiteAdminRouteData();
    return backendOk({
      adminPageId,
      databases,
      overrides,
      protectedRoutes,
      sourceVersion,
    });
  } catch (err: unknown) {
    return toBackendResultFromUnknown(err);
  }
}

export async function postSiteAdminRoutesBackend(
  command: SiteAdminRoutesCommand,
): Promise<SiteAdminBackendResult<Omit<SiteAdminRoutesPostPayload, "ok">>> {
  try {
    if (command.kind === "override") {
      if (!command.routePath) {
        return backendOk({
          sourceVersion: await disableOverride({
            pageId: command.pageId,
            expectedSiteConfigSha: command.expectedSiteConfigSha,
          }),
        });
      }

      return backendOk(
        await upsertOverride({
          pageId: command.pageId,
          routePath: command.routePath,
          expectedSiteConfigSha: command.expectedSiteConfigSha,
        }),
      );
    }

    if (command.kind === "protected") {
      const mode = "prefix" as const;
      if (command.authKind === "public") {
        return backendOk({
          sourceVersion: await disableProtected({
            pageId: command.pageId,
            path: command.path,
            expectedProtectedRoutesSha: command.expectedProtectedRoutesSha,
          }),
        });
      }
      return backendOk(
        await upsertProtected({
          pageId: command.pageId,
          path: command.path,
          mode,
          password: command.password,
          auth: command.authKind,
          expectedProtectedRoutesSha: command.expectedProtectedRoutesSha,
        }),
      );
    }

    return backendError("Unsupported request", 400, "UNSUPPORTED_REQUEST");
  } catch (err: unknown) {
    return toBackendResultFromUnknown(err);
  }
}

export async function getSiteAdminStatusBackend():
  Promise<SiteAdminBackendResult<Omit<SiteAdminStatusPayload, "ok">>> {
  try {
    const payload = await buildSiteAdminStatusPayload();
    return backendOk(payload);
  } catch (err: unknown) {
    return toBackendResultFromUnknown(err);
  }
}

export async function getSiteAdminDeployPreviewBackend():
  Promise<SiteAdminBackendResult<Omit<SiteAdminDeployPreviewPayload, "ok">>> {
  try {
    const payload = await buildSiteAdminDeployPreviewPayload();
    return backendOk(payload);
  } catch (err: unknown) {
    return toBackendResultFromUnknown(err);
  }
}

export async function postSiteAdminDeployBackend():
  Promise<SiteAdminBackendResult<Omit<SiteAdminDeployPayload, "ok">>> {
  try {
    const triggeredAtIso = new Date().toISOString();
    const sourceState = await getSiteAdminSourceStore().getSourceState().catch(() => null);
    const codeSha = pickRuntimeCodeSha();
    const contentSha = sourceState?.headSha?.toLowerCase() ?? null;
    const contentBranch = sourceState?.branch ?? null;
    const message = buildDeployMetadataMessage({
      label: "Deploy from site-admin",
      codeSha,
      contentSha,
      contentBranch,
    });
    const out = await triggerDeployHook(undefined, {
      message,
      expectedCloudflareVersion: {
        codeSha,
        contentSha,
        contentBranch,
      },
    });

    if (!out.ok) {
      const isStaleVersion = out.status === 409 && out.text.includes("DEPLOY_VERSION_STALE");
      return backendError(
        formatDeployTriggerError(out.status, out.attempts, trimErrorDetail(out.text)),
        isStaleVersion ? 409 : 502,
        isStaleVersion ? "DEPLOY_VERSION_STALE" : "DEPLOY_TRIGGER_FAILED",
      );
    }

    return backendOk({
      triggeredAt: triggeredAtIso,
      status: out.status,
      ...(out.provider ? { provider: out.provider } : {}),
      ...(out.deploymentId ? { deploymentId: out.deploymentId } : {}),
      ...(codeSha ? { codeSha } : {}),
      ...(contentSha ? { contentSha } : {}),
      ...(contentBranch ? { contentBranch } : {}),
    });
  } catch (err: unknown) {
    return toBackendResultFromUnknown(err);
  }
}
