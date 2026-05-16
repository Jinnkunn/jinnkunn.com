import {
  ReleaseRemoteJobsCard,
  ReleaseRunnerStatusCard,
  type ReleaseExecutionMode,
  type RemoteReleaseJobRow,
  type RemoteReleaseRunnerStatus,
} from "./release-runner-cards";
import type { SiteAdminReleaseJobState } from "../../modules/site-admin/tauri";

export function ReleaseRunnerDiagnostics({
  activeRemoteJobId,
  executionMode,
  formatRelativeTime,
  job,
  jobs,
  onOpenRemoteJob,
  onRefresh,
  onRetryRemoteJob,
  onRunSelfTest,
  onRunStatusCheck,
  ready,
  scriptLabel,
  shortId,
  status,
}: {
  activeRemoteJobId: string | null;
  executionMode: ReleaseExecutionMode;
  formatRelativeTime: (ms: number) => string;
  job: SiteAdminReleaseJobState | null;
  jobs: RemoteReleaseJobRow[];
  onOpenRemoteJob: (jobId: string) => void;
  onRefresh: () => void;
  onRetryRemoteJob: (jobId: string) => void;
  onRunSelfTest: () => void;
  onRunStatusCheck: () => void;
  ready: boolean;
  scriptLabel: (script: string) => string;
  shortId: (value?: string | null) => string;
  status: RemoteReleaseRunnerStatus | null;
}) {
  return (
    <>
      <ReleaseRunnerStatusCard
        executionMode={executionMode}
        formatRelativeTime={formatRelativeTime}
        jobs={jobs}
        onRefresh={onRefresh}
        onRunSelfTest={onRunSelfTest}
        onRunStatusCheck={onRunStatusCheck}
        shortId={shortId}
        selfTestDisabled={!ready || job?.status === "running"}
        statusCheckDisabled={!ready || job?.status === "running"}
        status={status}
      />

      <ReleaseRemoteJobsCard
        activeJobId={
          activeRemoteJobId ||
          (job?.cwd === "remote release runner" ? job.job_id : null)
        }
        formatRelativeTime={formatRelativeTime}
        jobs={jobs}
        onOpen={onOpenRemoteJob}
        onRetry={onRetryRemoteJob}
        scriptLabel={scriptLabel}
        shortId={shortId}
      />
    </>
  );
}
