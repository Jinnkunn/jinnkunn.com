import type {
  SiteAdminNowData,
  SiteAdminStatusPayload,
} from "./api-types.ts";

export type SiteAdminMobileStatusLike = Omit<SiteAdminStatusPayload, "ok"> & {
  ok?: true;
};

export type SiteAdminMobileReleaseActionKind =
  | "smart-release"
  | "watch-release"
  | "refresh"
  | "noop";

export type SiteAdminMobileJobLike = {
  id: string;
  action: string;
  script: string;
  target: "staging" | "production";
  status: string;
  phase: string;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  error: string;
};

export type SiteAdminMobileRunnerLike = {
  agentId: string;
  status: "idle" | "running";
  currentJobId: string;
  lastSeenAt: number;
};

export type SiteAdminMobileSummary = {
  generatedAt: string;
  site: {
    name: string;
    environment: string;
    runtime: string;
  };
  now: {
    text: string;
    context: string;
    location: string;
    updatedAt: string;
    historyCount: number;
  };
  calendar: {
    generatedAt: string;
    eventCount: number;
    rangeStartsAt: string;
    rangeEndsAt: string;
  };
  content: {
    posts: number;
    pages: number;
  };
  release: {
    headline: string;
    detail: string;
    recommendedAction: {
      kind: SiteAdminMobileReleaseActionKind;
      label: string;
      destructive: boolean;
    };
    runningJob: SiteAdminMobileJobLike | null;
    latestJob: SiteAdminMobileJobLike | null;
    runners: SiteAdminMobileRunnerLike[];
  };
  source: {
    storeKind: string;
    branch: string;
    codeSha: string;
    contentSha: string;
    pendingDeploy: boolean | null;
    deployableVersionReady: boolean | null;
  };
};

export type BuildSiteAdminMobileSummaryInput = {
  calendar?: {
    generatedAt?: string;
    eventCount?: number;
    rangeStartsAt?: string;
    rangeEndsAt?: string;
  };
  content?: {
    posts?: number;
    pages?: number;
  };
  generatedAt?: string;
  jobs?: SiteAdminMobileJobLike[];
  now?: SiteAdminNowData | null;
  runners?: SiteAdminMobileRunnerLike[];
  status?: SiteAdminMobileStatusLike | null;
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function shortSha(value: unknown): string {
  return str(value).slice(0, 7);
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isRunningJob(job: SiteAdminMobileJobLike): boolean {
  return job.status === "queued" || job.status === "running";
}

function latestJob(jobs: SiteAdminMobileJobLike[]): SiteAdminMobileJobLike | null {
  return jobs[0] ?? null;
}

function activeJob(jobs: SiteAdminMobileJobLike[]): SiteAdminMobileJobLike | null {
  return jobs.find(isRunningJob) ?? null;
}

function releaseState(input: {
  job: SiteAdminMobileJobLike | null;
  status: SiteAdminMobileStatusLike | null;
}): SiteAdminMobileSummary["release"] {
  const { job, status } = input;
  if (job) {
    const label = job.status === "queued" ? "Queued" : "Running";
    return {
      headline: `${label}: ${job.script}`,
      detail: job.phase || "Release job is active.",
      recommendedAction: {
        kind: "watch-release",
        label: "View Release",
        destructive: false,
      },
      runningJob: job,
      latestJob: null,
      runners: [],
    };
  }

  if (!status) {
    return {
      headline: "Status unavailable",
      detail: "Refresh before running a release.",
      recommendedAction: {
        kind: "refresh",
        label: "Refresh",
        destructive: false,
      },
      runningJob: null,
      latestJob: null,
      runners: [],
    };
  }

  const source = status.source;
  const needsRelease =
    source.pendingDeploy === true || source.deployableVersionReady === false;
  if (needsRelease) {
    return {
      headline: "Release needed",
      detail:
        source.deployableVersionReady === false
          ? source.deployableVersionReason || "Staging code needs a fresh deploy."
          : source.pendingDeployReason || "Saved content is ahead of the active deployment.",
      recommendedAction: {
        kind: "smart-release",
        label: "Smart Release",
        destructive: false,
      },
      runningJob: null,
      latestJob: null,
      runners: [],
    };
  }

  return {
    headline: "Up to date",
    detail: "No mobile release action is needed.",
    recommendedAction: {
      kind: "noop",
      label: "Current",
      destructive: false,
    },
    runningJob: null,
    latestJob: null,
    runners: [],
  };
}

export function buildSiteAdminMobileSummary(
  input: BuildSiteAdminMobileSummaryInput,
): SiteAdminMobileSummary {
  const status = input.status ?? null;
  const source = status?.source;
  const jobs = input.jobs ?? [];
  const running = activeJob(jobs);
  const release = releaseState({ job: running, status });
  const now = input.now;
  const calendar = input.calendar ?? {};

  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    site: {
      name: status?.content?.siteName || "jinkunchen.com",
      environment: status?.build?.branch || source?.branch || "",
      runtime: status?.env?.runtimeProvider || "unknown",
    },
    now: {
      text: str(now?.current?.text),
      context: str(now?.current?.context),
      location: str(now?.current?.location),
      updatedAt: str(now?.current?.updatedAt),
      historyCount: now?.updates?.length ?? 0,
    },
    calendar: {
      generatedAt: str(calendar.generatedAt),
      eventCount: Number(calendar.eventCount || 0),
      rangeStartsAt: str(calendar.rangeStartsAt),
      rangeEndsAt: str(calendar.rangeEndsAt),
    },
    content: {
      posts: Number(input.content?.posts || 0),
      pages: Number(input.content?.pages || 0),
    },
    release: {
      ...release,
      latestJob: latestJob(jobs),
      runners: input.runners ?? [],
    },
    source: {
      storeKind: str(source?.storeKind),
      branch: str(source?.contentBranch || source?.branch),
      codeSha: shortSha(source?.codeSha),
      contentSha: shortSha(source?.contentSha),
      pendingDeploy: boolOrNull(source?.pendingDeploy),
      deployableVersionReady: boolOrNull(source?.deployableVersionReady),
    },
  };
}
