import { useMemo } from "react";

import { useSiteAdmin } from "./state";
import { getSiteAdminEnvironment } from "./utils";

interface SiteAdminEnvironmentBannerProps {
  actionLabel?: string;
  className?: string;
}

export function SiteAdminEnvironmentBanner({
  actionLabel = "edit",
  className = "",
}: SiteAdminEnvironmentBannerProps) {
  const {
    environment,
    productionReadOnly,
    profiles,
    switchProfile,
  } = useSiteAdmin();

  const stagingProfile = useMemo(
    () =>
      profiles.find(
        (profile) => getSiteAdminEnvironment(profile.baseUrl).kind === "staging",
      ) ?? null,
    [profiles],
  );

  if (!productionReadOnly) return null;

  return (
    <div
      className={`site-admin-environment-banner ${className}`.trim()}
      role="status"
    >
      <div>
        <strong>{environment.label} is read-only</strong>
        <span>
          Switch to Staging to {actionLabel}, validate there, then promote with
          the production runbook.
        </span>
      </div>
      {stagingProfile ? (
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => switchProfile(stagingProfile.id)}
        >
          Switch to Staging
        </button>
      ) : null}
    </div>
  );
}
