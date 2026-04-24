import { readApiErrorCode, readApiErrorMessage } from "@/lib/client/api-guards";
import {
  isSiteAdminConfigGetOk,
  isSiteAdminConfigPostOk,
  parseSiteAdminConfigGet,
  parseSiteAdminConfigPost,
} from "@/lib/site-admin/config-contract";
import {
  isSiteAdminDeployOk,
  parseSiteAdminDeployResult,
} from "@/lib/site-admin/deploy-contract";
import {
  isSiteAdminDeployPreviewOk,
  parseSiteAdminDeployPreviewResult,
} from "@/lib/site-admin/deploy-preview-contract";
import {
  isSiteAdminRoutesOk,
  isSiteAdminRoutesPostOk,
  parseSiteAdminRoutesPost,
  parseSiteAdminRoutesResult,
} from "@/lib/site-admin/routes-contract";
import {
  isSiteAdminStatusOk,
  parseSiteAdminStatusResult,
} from "@/lib/site-admin/status-contract";
import type {
  SiteAdminConfigSourceVersion,
  SiteAdminConfigGetPayload,
  SiteAdminConfigPostPayload,
  SiteAdminDeployPayload,
  SiteAdminDeployPreviewPayload,
  SiteAdminRoutesGetPayload,
  SiteAdminRoutesPostPayload,
  SiteAdminStatusPayload,
} from "@/lib/site-admin/api-types";
import type { NavItemRow, SiteSettings } from "@/lib/site-admin/types";
import type { AccessMode } from "@/lib/shared/access";

type FetchLike = typeof fetch;

export type SiteAdminConfigCommand =
  | {
      kind: "settings";
      rowId: string;
      patch: Partial<Omit<SiteSettings, "rowId">>;
      expectedSiteConfigSha: string;
    }
  | {
      kind: "nav-update";
      rowId: string;
      patch: Partial<Omit<NavItemRow, "rowId">>;
      expectedSiteConfigSha: string;
    }
  | {
      kind: "nav-create";
      input: Omit<NavItemRow, "rowId">;
      expectedSiteConfigSha: string;
    };

export type SiteAdminConfigSettingsCommand = Extract<SiteAdminConfigCommand, { kind: "settings" }>;
export type SiteAdminConfigNavUpdateCommand = Extract<SiteAdminConfigCommand, { kind: "nav-update" }>;
export type SiteAdminConfigNavCreateCommand = Extract<SiteAdminConfigCommand, { kind: "nav-create" }>;
export type SiteAdminConfigSourceState = SiteAdminConfigSourceVersion;

export type SiteAdminRoutesPostCommand =
  | {
      kind: "override";
      pageId: string;
      routePath: string;
      expectedSiteConfigSha: string;
    }
  | {
      kind: "protected";
      pageId: string;
      path: string;
      auth: AccessMode;
      password?: string;
      expectedProtectedRoutesSha: string;
    };

export type SiteAdminBackendClientOptions = {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
};

type ParseOptions<T, TOk extends T> = {
  parse: (raw: unknown) => T | null;
  isOk: (parsed: T) => parsed is TOk;
  fallbackError?: string;
};

function asHeaders(input: HeadersInit | undefined): Record<string, string> {
  if (!input) return {};
  if (input instanceof Headers) {
    return Object.fromEntries(input.entries());
  }
  if (Array.isArray(input)) {
    const out: Record<string, string> = {};
    for (const [k, v] of input) out[String(k)] = String(v);
    return out;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null) continue;
    out[k] = String(v);
  }
  return out;
}

async function resolveHeaders(
  input: SiteAdminBackendClientOptions["headers"],
): Promise<Record<string, string>> {
  if (!input) return {};
  const raw = typeof input === "function" ? await input() : input;
  return asHeaders(raw);
}

function formatApiError(raw: unknown, response: Response, fallbackError = "Request failed"): string {
  const code = readApiErrorCode(raw);
  const message = readApiErrorMessage(raw) || fallbackError || `HTTP ${response.status}`;
  return code ? `${code}: ${message}` : message;
}

function withPath(baseUrl: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!baseUrl.trim()) return p;
  return `${baseUrl.replace(/\/+$/, "")}${p}`;
}

async function requestParsed<T, TOk extends T>(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit | undefined,
  parseOptions: ParseOptions<T, TOk>,
): Promise<TOk> {
  const response = await fetchImpl(url, init);
  const raw = await response.json().catch(() => null);
  const parsed = parseOptions.parse(raw);
  const okByType = Boolean(parsed && parseOptions.isOk(parsed));
  if (!response.ok || !okByType) {
    throw new Error(formatApiError(parsed ?? raw, response, parseOptions.fallbackError));
  }
  return parsed as TOk;
}

export function createSiteAdminBackendClient(
  options: SiteAdminBackendClientOptions = {},
) {
  const baseUrl = String(options.baseUrl || "").trim();
  const fetchImpl: FetchLike = options.fetchImpl || fetch;

  async function request<T, TOk extends T>(
    path: string,
    init: RequestInit | undefined,
    parseOptions: ParseOptions<T, TOk>,
  ): Promise<TOk> {
    const extraHeaders = await resolveHeaders(options.headers);
    const headers = asHeaders(init?.headers);
    return requestParsed(
      fetchImpl,
      withPath(baseUrl, path),
      {
        ...init,
        headers: {
          ...extraHeaders,
          ...headers,
        },
      },
      parseOptions,
    );
  }

  return {
    async getConfig(): Promise<SiteAdminConfigGetPayload> {
      return request(
        "/api/site-admin/config",
        { cache: "no-store" },
        {
          parse: parseSiteAdminConfigGet,
          isOk: isSiteAdminConfigGetOk,
          fallbackError: "Failed to load site-admin config",
        },
      );
    },

    async postConfig(
      command: SiteAdminConfigCommand,
    ): Promise<SiteAdminConfigPostPayload> {
      return request(
        "/api/site-admin/config",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command),
        },
        {
          parse: parseSiteAdminConfigPost,
          isOk: isSiteAdminConfigPostOk,
          fallbackError: "Failed to save site-admin config",
        },
      );
    },

    async getRoutes(): Promise<SiteAdminRoutesGetPayload> {
      return request(
        "/api/site-admin/routes",
        { cache: "no-store" },
        {
          parse: parseSiteAdminRoutesResult,
          isOk: isSiteAdminRoutesOk,
          fallbackError: "Failed to load site-admin routes",
        },
      );
    },

    async postRoutes(
      command: SiteAdminRoutesPostCommand,
    ): Promise<SiteAdminRoutesPostPayload> {
      return request(
        "/api/site-admin/routes",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command),
        },
        {
          parse: parseSiteAdminRoutesPost,
          isOk: isSiteAdminRoutesPostOk,
          fallbackError: "Failed to save site-admin routes",
        },
      );
    },

    async getStatus(): Promise<SiteAdminStatusPayload> {
      return request(
        "/api/site-admin/status",
        { cache: "no-store" },
        {
          parse: parseSiteAdminStatusResult,
          isOk: isSiteAdminStatusOk,
          fallbackError: "Failed to load site-admin status",
        },
      );
    },

    async getDeployPreview(): Promise<SiteAdminDeployPreviewPayload> {
      return request(
        "/api/site-admin/deploy-preview",
        { cache: "no-store" },
        {
          parse: parseSiteAdminDeployPreviewResult,
          isOk: isSiteAdminDeployPreviewOk,
          fallbackError: "Failed to load deploy preview",
        },
      );
    },

    async postDeploy(): Promise<SiteAdminDeployPayload> {
      return request(
        "/api/site-admin/deploy",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
        },
        {
          parse: parseSiteAdminDeployResult,
          isOk: isSiteAdminDeployOk,
          fallbackError: "Failed to trigger deploy",
        },
      );
    },
  };
}

export type SiteAdminBackendClient = ReturnType<typeof createSiteAdminBackendClient>;
