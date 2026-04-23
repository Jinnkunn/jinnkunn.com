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
  } = useSiteAdmin();

  const [open, setOpen] = useState(false);
  const [cfExpanded, setCfExpanded] = useState(
    Boolean(connection.cfAccessClientId || connection.cfAccessClientSecret),
  );
  const [cfId, setCfId] = useState("");
  const [cfSecret, setCfSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);

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

  const pillLabel = connection.authLoading
    ? "Signing in…"
    : hasToken
      ? connection.authLogin
        ? `Signed in · ${connection.authLogin}`
        : "Signed in"
      : hasCfService
        ? "CF Access"
        : "Not connected";

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
