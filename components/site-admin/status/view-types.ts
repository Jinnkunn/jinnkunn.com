import type { StatusPayload } from "@/components/site-admin/status/types";
import type { GeneratedState, ReadinessState, StatusFreshness } from "@/lib/site-admin/status-model";

export type StatusViewCoreProps = {
  payload: StatusPayload;
};

export type StatusViewDerivedProps = {
  stale: StatusFreshness;
  generated: GeneratedState;
  readiness: ReadinessState;
  vercelLink: string;
};
