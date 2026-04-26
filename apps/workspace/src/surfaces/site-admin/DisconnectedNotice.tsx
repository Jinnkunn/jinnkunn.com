import { useSiteAdmin } from "./state";

// Surface-level "you are not connected" placeholder. Replaces the would-be
// panel content when no auth token is in memory, so we don't render a
// half-functional panel full of disabled buttons. Clicking the primary
// action sets the topbar's connection pill `data-open-request` attribute,
// which the pill component listens for and uses to open its popover.
function openConnectionPill() {
  const pill = document.querySelector(".site-admin-pill");
  if (pill instanceof HTMLButtonElement) {
    pill.click();
    pill.focus();
  }
}

export function DisconnectedNotice() {
  const { connection } = useSiteAdmin();
  const loading = connection.authLoading;
  const baseUrl = connection.baseUrl;

  if (loading) {
    return (
      <section className="surface-card disconnected-notice" role="status">
        <div className="disconnected-notice__inner">
          <span className="loading-spinner" aria-hidden="true" />
          <h2 className="disconnected-notice__title">Connecting…</h2>
          <p className="disconnected-notice__body">
            Reading credentials from the keyring for{" "}
            <code>{baseUrl || "the workspace API"}</code>.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="surface-card disconnected-notice"
      aria-labelledby="disconnected-notice-title"
    >
      <div className="disconnected-notice__inner">
        <span className="disconnected-notice__icon" aria-hidden="true">
          ⏻
        </span>
        <h2
          id="disconnected-notice-title"
          className="disconnected-notice__title"
        >
          Workspace not connected
        </h2>
        <p className="disconnected-notice__body">
          Connect to a site-admin endpoint to load posts, pages, and the rest
          of your content. Your credentials are stored in the OS keyring and
          never leave this machine.
        </p>
        <div className="disconnected-notice__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={openConnectionPill}
          >
            Open connection settings
          </button>
        </div>
        {baseUrl ? (
          <p className="disconnected-notice__hint">
            Current endpoint: <code>{baseUrl}</code>
          </p>
        ) : null}
      </div>
    </section>
  );
}
