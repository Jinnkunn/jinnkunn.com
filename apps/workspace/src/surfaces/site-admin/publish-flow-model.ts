import type { StatusPayload } from "./types";
import { normalizeString } from "./utils";

export type DeployPreviewSummaryKey =
  | "pagesAdded"
  | "pagesRemoved"
  | "redirectsAdded"
  | "redirectsRemoved"
  | "redirectsChanged"
  | "protectedAdded"
  | "protectedRemoved"
  | "protectedChanged"
  | "componentsChanged";

export type DeployPreviewRedirectChange = {
  kind?: string;
  source?: string;
  pageId?: string;
  title?: string;
  fromPath?: string;
  toPath?: string;
};

export type DeployPreviewProtectedChange = {
  kind?: string;
  pageId?: string;
  path?: string;
  mode?: string;
  auth?: string;
  previousMode?: string;
  previousAuth?: string;
};

export type DeployPreviewComponentChange = {
  name?: string;
  label?: string;
  sourcePath?: string;
  embedTag?: string;
  affectedRoutes?: string[];
};

export type DeployPreviewData = {
  generatedAt?: string;
  hasChanges?: boolean;
  summary?: Partial<Record<DeployPreviewSummaryKey, number>>;
  samples?: {
    pagesAdded?: string[];
    pagesRemoved?: string[];
    redirects?: DeployPreviewRedirectChange[];
    protected?: DeployPreviewProtectedChange[];
    components?: DeployPreviewComponentChange[];
  };
};

export const SUMMARY_LABELS: Array<[DeployPreviewSummaryKey, string]> = [
  ["pagesAdded", "Pages added"],
  ["pagesRemoved", "Pages removed"],
  ["redirectsAdded", "Redirects added"],
  ["redirectsRemoved", "Redirects removed"],
  ["redirectsChanged", "Redirects changed"],
  ["protectedAdded", "Protected added"],
  ["protectedRemoved", "Protected removed"],
  ["protectedChanged", "Protected changed"],
  ["componentsChanged", "Shared content changed"],
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function parseDeployPreview(raw: unknown): DeployPreviewData {
  const data = asRecord(raw);
  const summary = asRecord(data.summary);
  const samples = asRecord(data.samples);
  return {
    generatedAt: normalizeString(data.generatedAt),
    hasChanges:
      typeof data.hasChanges === "boolean" ? data.hasChanges : undefined,
    summary: Object.fromEntries(
      SUMMARY_LABELS.map(([key]) => [
        key,
        typeof summary[key] === "number" ? summary[key] : 0,
      ]),
    ) as DeployPreviewData["summary"],
    samples: {
      pagesAdded: asStringArray(samples.pagesAdded),
      pagesRemoved: asStringArray(samples.pagesRemoved),
      redirects: Array.isArray(samples.redirects)
        ? samples.redirects.map((item) => {
            const record = asRecord(item);
            return {
              kind: normalizeString(record.kind),
              source: normalizeString(record.source),
              pageId: normalizeString(record.pageId),
              title: normalizeString(record.title),
              fromPath: normalizeString(record.fromPath),
              toPath: normalizeString(record.toPath),
            };
          })
        : [],
      protected: Array.isArray(samples.protected)
        ? samples.protected.map((item) => {
            const record = asRecord(item);
            return {
              kind: normalizeString(record.kind),
              pageId: normalizeString(record.pageId),
              path: normalizeString(record.path),
              mode: normalizeString(record.mode),
              auth: normalizeString(record.auth),
              previousMode: normalizeString(record.previousMode),
              previousAuth: normalizeString(record.previousAuth),
            };
          })
        : [],
      components: Array.isArray(samples.components)
        ? samples.components.map((item) => {
            const record = asRecord(item);
            return {
              name: normalizeString(record.name),
              label: normalizeString(record.label),
              sourcePath: normalizeString(record.sourcePath),
              embedTag: normalizeString(record.embedTag),
              affectedRoutes: asStringArray(record.affectedRoutes),
            };
          })
        : [],
    },
  };
}

export function parseStatusPayload(raw: unknown): StatusPayload | null {
  const data = asRecord(raw);
  if (!data.source || !data.env || !data.build) return null;
  return data as unknown as StatusPayload;
}

export function parseSourceSnapshot(raw: unknown): StatusPayload["source"] | null {
  const data = asRecord(raw);
  const source = asRecord(data.source);
  if (!Object.keys(source).length) return null;
  return {
    storeKind: normalizeString(source.storeKind),
    branch: normalizeString(source.branch),
    headSha: normalizeString(source.headSha),
    pendingDeploy:
      typeof source.pendingDeploy === "boolean"
        ? source.pendingDeploy
        : source.pendingDeploy === null
          ? null
          : undefined,
    pendingDeployReason: normalizeString(source.pendingDeployReason),
    codeSha: normalizeString(source.codeSha),
    contentSha: normalizeString(source.contentSha),
    contentBranch: normalizeString(source.contentBranch),
    deployableVersionReady:
      typeof source.deployableVersionReady === "boolean"
        ? source.deployableVersionReady
        : source.deployableVersionReady === null
          ? null
          : undefined,
    deployableVersionReason: normalizeString(source.deployableVersionReason),
    deployableVersionId: normalizeString(source.deployableVersionId),
  };
}

export function previewSummaryText(preview: DeployPreviewData): string {
  const counts = SUMMARY_LABELS.filter(
    ([key]) => (preview.summary?.[key] ?? 0) > 0,
  )
    .map(([key, label]) => `${label} ${preview.summary?.[key] ?? 0}`)
    .join(" · ");
  if (counts) return counts;
  return preview.hasChanges === false
    ? "No route/protection changes detected."
    : "Preview loaded.";
}

export function isStagingOrigin(baseUrl: string): boolean {
  return /\/\/staging\./i.test(baseUrl);
}
