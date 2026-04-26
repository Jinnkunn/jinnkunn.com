import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  readSiteAdminJsonCommand,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import {
  AssetsValidationError,
  deleteAsset,
  listAssets,
  uploadAsset,
} from "@/lib/server/assets-store";
import type { ParseResult } from "@/lib/site-admin/request-types";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-assets", maxRequests: 20 };

type UploadCommand = {
  filename?: string;
  contentType: string;
  base64: string; // raw base64, no "data:..." prefix
};

const DATA_URL_RE = /^data:([^;]+);base64,([\s\S]+)$/;

function parseUploadCommand(
  body: Record<string, unknown>,
): ParseResult<UploadCommand> {
  const filenameRaw = typeof body.filename === "string" ? body.filename.trim() : "";
  const filename = filenameRaw || undefined;
  const rawBase64 = typeof body.base64 === "string" ? body.base64.trim() : "";
  const rawData = typeof body.data === "string" ? body.data.trim() : "";
  const data = rawBase64 || rawData;
  if (!data)
    return { ok: false, error: "base64 data is required", status: 400 };
  let contentType =
    typeof body.contentType === "string" ? body.contentType.trim() : "";

  // Accept a data URL shape and peel off the prefix.
  const dataUrl = DATA_URL_RE.exec(data);
  const payload = dataUrl ? dataUrl[2] : data;
  if (dataUrl && !contentType) contentType = dataUrl[1];

  if (!contentType)
    return { ok: false, error: "contentType is required", status: 400 };

  return {
    ok: true,
    value: { filename, contentType, base64: payload.replace(/\s+/g, "") },
  };
}

type DeleteCommand = {
  key: string;
  version: string;
};

function parseDeleteCommand(
  body: Record<string, unknown>,
): ParseResult<DeleteCommand> {
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const version = typeof body.version === "string" ? body.version.trim() : "";
  if (!key) return { ok: false, error: "key is required", status: 400 };
  if (!version) return { ok: false, error: "version is required", status: 400 };
  return { ok: true, value: { key, version } };
}

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      const assets = await listAssets();
      return apiPayloadOk({
        assets: assets.map((asset) => ({
          key: asset.key,
          url: asset.url,
          filename: asset.filename,
          size: asset.size,
          contentType: asset.contentType,
          version: asset.sha,
          uploadedAt: asset.uploadedAt,
        })),
      });
    },
    { rateLimit: RATE_LIMIT },
  );
}

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const parsed = await readSiteAdminJsonCommand(req, parseUploadCommand);
      if (!parsed.ok) return parsed.res;
      const { filename, contentType, base64 } = parsed.value;

      let data: Uint8Array;
      try {
        data = Uint8Array.from(Buffer.from(base64, "base64"));
      } catch {
        return apiError("invalid base64 payload", { status: 400, code: "BAD_REQUEST" });
      }

      let result: "success" | "error" = "success";
      let code = "OK";
      let message = "";
      let status = 201;
      try {
        const uploaded = await uploadAsset({ filename, contentType, data });
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "assets.upload",
          endpoint: "/api/site-admin/assets",
          method: "POST",
          status,
          result,
          code,
          message,
          metadata: {
            key: uploaded.key,
            url: uploaded.url,
            size: uploaded.size,
            contentType: uploaded.contentType,
          },
        });
        return apiPayloadOk(
          {
            key: uploaded.key,
            url: uploaded.url,
            size: uploaded.size,
            contentType: uploaded.contentType,
            version: uploaded.sha,
          },
          { status },
        );
      } catch (err) {
        if (err instanceof AssetsValidationError) {
          result = "error";
          code = "BAD_REQUEST";
          message = err.message;
          status = 400;
        } else {
          result = "error";
          code = "ASSET_UPLOAD_FAILED";
          message = err instanceof Error ? err.message : "unexpected error";
          status = 500;
        }
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "assets.upload",
          endpoint: "/api/site-admin/assets",
          method: "POST",
          status,
          result,
          code,
          message,
          metadata: { filename: filename ?? null, contentType },
        });
        return apiError(message, { status, code });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}

export async function DELETE(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const parsed = await readSiteAdminJsonCommand(req, parseDeleteCommand);
      if (!parsed.ok) return parsed.res;
      const { key, version } = parsed.value;

      let result: "success" | "error" = "success";
      let code = "OK";
      let message = "";
      let status = 200;
      try {
        await deleteAsset(key, version);
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "assets.delete",
          endpoint: "/api/site-admin/assets",
          method: "DELETE",
          status,
          result,
          code,
          message,
          metadata: { key, version },
        });
        return apiPayloadOk({ deleted: true });
      } catch (err) {
        result = "error";
        if (err instanceof AssetsValidationError) {
          code = "BAD_REQUEST";
          message = err.message;
          status = 400;
        } else {
          code = "ASSET_DELETE_FAILED";
          message = err instanceof Error ? err.message : "unexpected error";
          status = 500;
        }
        await writeSiteAdminAuditLog({
          actor: ctx.login,
          action: "assets.delete",
          endpoint: "/api/site-admin/assets",
          method: "DELETE",
          status,
          result,
          code,
          message,
          metadata: { key, version },
        });
        return apiError(message, { status, code });
      }
    },
    { rateLimit: RATE_LIMIT },
  );
}
