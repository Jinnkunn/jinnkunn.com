import { useCallback, useEffect, useRef, useState } from "react";
import { useSiteAdmin } from "./state";
import { normalizeString, stripTrailingSlash } from "./utils";

type PillTone = "connected" | "loading" | "disconnected";

function tone(
  authLoading: boolean,
  hasToken: boolean,
  hasCfService: boolean,
): PillTone {
  if (authLoading) return "loading";
  if (hasToken || hasCfService) return "connected";
  return "disconnected";
}

/** Compact connection status indicator rendered in the top bar. Clicking it
 * expands a popover with the full Base URL + sign-in controls + CF Access
 * section — i.e. everything `ConnectionCard` used to show as a permanent
 * always-visible panel, but tucked away until the user actually wants it. */
export function SiteAdminConnectionPill() {
  const {
    connection,
    setBaseUrl,
    saveConnectionLocally,
    signInWithBrowser,
    clearAuth,
    setCfAccessServiceToken,
    clearCfAccessServiceToken,
    profiles,
    activeProfileId,
    switchProfile,
    addProfile,
    renameProfile,
    removeProfile,
  } = useSiteAdmin();

  const [open, setOpen] = useState(false);
  const [cfExpanded, setCfExpanded] = useState(
    Boolean(connection.cfAccessClientId || connection.cfAccessClientSecret),
  );
  const [cfId, setCfId] = useState("");
  const [cfSecret, setCfSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  // Profile editing state. Tauri's webview suppresses `window.prompt` /
  // `window.confirm`, so we roll our own inline forms instead of relying
  // on native dialogs.
  type ProfileMode = "idle" | "rename" | "add" | "confirmDelete";
  const [profileMode, setProfileMode] = useState<ProfileMode>("idle");
  const [renameValue, setRenameValue] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const resetProfileMode = useCallback(() => {
    setProfileMode("idle");
    setRenameValue("");
    setAddLabel("");
    setAddUrl("");
  }, []);

  const rootRef = useRef<HTMLDivElement | null>(null);

  // Click-outside → close. Also Escape key.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const base = connection.baseUrl || "";
  const trimmedBase = stripTrailingSlash(base);
  const hasCfService = Boolean(
    connection.cfAccessClientId && connection.cfAccessClientSecret,
  );
  const hasToken = Boolean(connection.authToken);
  const currentTone = tone(connection.authLoading, hasToken, hasCfService);

  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const profileLabel = activeProfile?.label ?? "Default";
  const statusLabel = connection.authLoading
    ? "Signing in…"
    : hasToken
      ? connection.authLogin
        ? `Signed in · ${connection.authLogin}`
        : "Signed in"
      : hasCfService
        ? "CF Access"
        : "Not connected";
  const pillLabel = currentTone === "connected"
    ? profileLabel
    : `${profileLabel} · ${statusLabel}`;
  const pillTitle = [profileLabel, statusLabel, trimmedBase].filter(Boolean).join(" · ");

  const disableLogin = connection.authLoading || !normalizeString(connection.baseUrl);
  const disableClear = connection.authLoading || !connection.authToken;
  const cfSaveDisabled = !cfId.trim() || !cfSecret.trim();

  const toggle = useCallback(() => setOpen((o) => !o), []);

  return (
    <div className="site-admin-pill-root" ref={rootRef}>
      <button
        type="button"
        className="site-admin-pill"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tone={currentTone}
        title={pillTitle}
      >
        <span className="site-admin-pill__dot" aria-hidden="true" />
        <span className="site-admin-pill__label">{pillLabel}</span>
        <svg
          viewBox="0 0 10 10"
          width="8"
          height="8"
          aria-hidden="true"
          style={{
            transition: "transform 140ms ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <path
            d="M2 4l3 3 3-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="site-admin-pill__popover" role="dialog" aria-label="Connection">
          <header className="site-admin-pill__popover-header">
            <h3>Connection</h3>
            <p>API endpoint + app-token (browser sign-in).</p>
          </header>

          <div
            className="site-admin-pill__field site-admin-pill__profile-field"
            data-profile-mode={profileMode}
          >
            <span>Profile</span>

            {profileMode === "rename" ? (
              <div className="site-admin-pill__profile-row">
                <input
                  className="site-admin-pill__profile-select"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && renameValue.trim()) {
                      renameProfile(activeProfileId, renameValue.trim());
                      resetProfileMode();
                    } else if (event.key === "Escape") {
                      resetProfileMode();
                    }
                  }}
                  autoFocus
                  placeholder="Profile name"
                />
                <button
                  type="button"
                  className="btn btn--secondary site-admin-pill__profile-btn"
                  disabled={!renameValue.trim()}
                  onClick={() => {
                    renameProfile(activeProfileId, renameValue.trim());
                    resetProfileMode();
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="btn btn--ghost site-admin-pill__profile-btn"
                  onClick={resetProfileMode}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="site-admin-pill__profile-row">
                <select
                  className="site-admin-pill__profile-select"
                  value={activeProfileId}
                  onChange={(event) => switchProfile(event.target.value)}
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {profileMode === "confirmDelete" ? (
                  <>
                    <button
                      type="button"
                      className="btn btn--danger site-admin-pill__profile-btn"
                      onClick={() => {
                        removeProfile(activeProfileId);
                        resetProfileMode();
                      }}
                    >
                      Confirm delete
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost site-admin-pill__profile-btn"
                      onClick={resetProfileMode}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn--ghost site-admin-pill__profile-btn"
                      title="Rename current profile"
                      onClick={() => {
                        setRenameValue(activeProfile?.label ?? "");
                        setProfileMode("rename");
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost site-admin-pill__profile-btn"
                      title="Add a new profile"
                      onClick={() => {
                        setAddLabel("");
                        setAddUrl(base || "https://");
                        setProfileMode("add");
                      }}
                    >
                      + Add
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost site-admin-pill__profile-btn"
                      title="Delete current profile"
                      disabled={profiles.length <= 1}
                      onClick={() => setProfileMode("confirmDelete")}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            )}

            {profileMode === "add" && (
              <div className="site-admin-pill__profile-add">
                <input
                  className="site-admin-pill__profile-add-input"
                  value={addLabel}
                  onChange={(event) => setAddLabel(event.target.value)}
                  placeholder="Profile name (e.g. Staging)"
                  autoFocus
                />
                <input
                  className="site-admin-pill__profile-add-input"
                  value={addUrl}
                  onChange={(event) => setAddUrl(event.target.value)}
                  placeholder="Base URL"
                  spellCheck={false}
                  autoComplete="off"
                />
                <div className="site-admin-pill__profile-add-actions">
                  <button
                    type="button"
                    className="btn btn--secondary site-admin-pill__profile-btn"
                    disabled={!addLabel.trim() || !addUrl.trim()}
                    onClick={() => {
                      const id = addProfile(addLabel.trim(), addUrl.trim());
                      switchProfile(id);
                      resetProfileMode();
                    }}
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost site-admin-pill__profile-btn"
                    onClick={resetProfileMode}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {profileMode === "confirmDelete" && (
              <p className="site-admin-pill__note site-admin-pill__profile-warn">
                Credentials stay in the keyring — only the profile entry is
                removed.
              </p>
            )}
          </div>

          <label className="site-admin-pill__field">
            <span>API Base URL</span>
            <input
              value={base}
              onChange={(e) => setBaseUrl(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </label>

          <div className="site-admin-pill__actions">
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => void signInWithBrowser()}
              disabled={disableLogin}
            >
              Sign in with browser
            </button>
            <button
              className="btn btn--ghost"
              type="button"
              onClick={saveConnectionLocally}
            >
              Save
            </button>
            <button
              className="btn btn--ghost"
              type="button"
              onClick={() => void clearAuth()}
              disabled={disableClear}
            >
              Clear
            </button>
          </div>

          {connection.authExpiresAt && (
            <p className="site-admin-pill__note">
              Token expires {connection.authExpiresAt}
            </p>
          )}

          <div className="site-admin-pill__links">
            <a href={`${trimmedBase}/site-admin`} target="_blank" rel="noreferrer">
              Open /site-admin
            </a>
            <a
              href={`${trimmedBase}/site-admin/login`}
              target="_blank"
              rel="noreferrer"
            >
              Open /site-admin/login
            </a>
          </div>

          <details
            open={cfExpanded}
            onToggle={(event) =>
              setCfExpanded((event.target as HTMLDetailsElement).open)
            }
            className="site-admin-pill__cf"
          >
            <summary>
              Cloudflare Access service token{" "}
              <span className="site-admin-pill__muted">disabled server-side</span>
            </summary>
            <div className="site-admin-pill__cf-body">
              <p className="site-admin-pill__warn">
                ⚠︎ Server is in <code>SITE_ADMIN_AUTH_MODE=legacy</code> — CF Access
                JWTs are ignored. Values saved here won&rsquo;t authenticate.
              </p>
              <label className="site-admin-pill__field">
                <span>Client ID</span>
                <input
                  value={cfId}
                  onChange={(e) => setCfId(e.target.value)}
                  placeholder="xxxxxxxxxxxxxxxxxxxx.access"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <label className="site-admin-pill__field">
                <span>Client Secret</span>
                <input
                  value={cfSecret}
                  onChange={(e) => setCfSecret(e.target.value)}
                  type={showSecret ? "text" : "password"}
                  placeholder="(paste once; stored in keychain)"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <div className="site-admin-pill__actions">
                <button
                  className="btn btn--secondary"
                  type="button"
                  onClick={() => {
                    void setCfAccessServiceToken(cfId, cfSecret);
                    setCfId("");
                    setCfSecret("");
                  }}
                  disabled={cfSaveDisabled}
                >
                  Save token
                </button>
                <button
                  className="btn btn--ghost"
                  type="button"
                  onClick={() => void clearCfAccessServiceToken()}
                  disabled={!hasCfService}
                >
                  Clear token
                </button>
                <label className="site-admin-pill__reveal">
                  <input
                    type="checkbox"
                    checked={showSecret}
                    onChange={(e) => setShowSecret(e.target.checked)}
                  />
                  Reveal secret
                </label>
              </div>
              {hasCfService && (
                <p className="site-admin-pill__note">
                  Stored ID: <code>{connection.cfAccessClientId}</code>
                </p>
              )}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
