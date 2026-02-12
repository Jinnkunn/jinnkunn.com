import type { GeneratedState, ReadinessState, StatusFreshness } from "@/components/site-admin/status/use-status-data";
import type { StatusPayload } from "@/components/site-admin/status/types";

export type StatusViewCoreProps = {
  payload: StatusPayload;
};

export type StatusViewDerivedProps = {
  stale: StatusFreshness;
  generated: GeneratedState;
  readiness: ReadinessState;
  vercelLink: string;
};
