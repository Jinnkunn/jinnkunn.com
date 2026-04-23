import { useState } from "react";
import { useSiteAdmin } from "./state";
import { normalizeString, stripTrailingSlash } from "./utils";

/** Connection card — moved OUT of the global sidebar and INTO the
 * site-admin surface so its base URL + auth token don't pollute the
 * shell. Each tool owns its own connection/auth UI. */
export function ConnectionCard() {
  const {
    connection,
    setBaseUrl,
    saveConnectionLocally,
    signInWithBrowser,
    clearAuth,
    setCfAccessServiceToken,
    clearCfAccessServiceToken,
  } = useSiteAdmin();
  const [cfExpanded, setCfExpanded] = useState(
    Boolean(connection.cfAccessClientId || connection.cfAccessClientSecret),
  );
  const [cfId, setCfId] = useState("");
  const [cfSecret, setCfSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  const base = connection.baseUrl || "";
  const trimmedBase = stripTrailingSlash(base);

  const hasCfService = Boolean(
    connection.cfAccessClientId && connection.cfAccessClientSecret,
  );

  const authStatusNote = connection.authLoading
    ? "Authentication in progress…"
    : hasCfService
      ? `CF Access service token active (${connection.cfAccessClientId.slice(0, 12)}…)`
      : connection.authToken
        ? [
            connection.authLogin ? `Signed in as ${connection.authLogin}` : "Signed in",
            connection.authExpiresAt ? `expires ${connection.authExpiresAt}` : "",
          ]
            .filter(Boolean)
            .join(", ")
        : "No credentials loaded.";

  const disableLogin = connection.authLoading || !normalizeString(connection.baseUrl);
  const disableClear = connection.authLoading || !connection.authToken;
  const cfSaveDisabled = !cfId.trim() || !cfSecret.trim();

  return (
    <section className="rounded-[14px] border border-border-subtle bg-bg-surface p-4 flex flex-col gap-3">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="m-0 text-[15px] font-semibold text-text-primary tracking-[-0.01em]">
            Connection
          </h2>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Site admin API endpoint + app-token issued via browser sign-in.
          </p>
        </div>
        <span
          className="inline-flex items-center gap-2 text-[12px] text-text-muted"
          aria-live="polite"
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{
              background: connection.authLoading
                ? "var(--color-warn)"
                : connection.authToken
                  ? "var(--color-success)"
                  : "var(--color-border-strong)",
              boxShadow: connection.authToken
                ? "0 0 0 3px color-mix(in srgb, var(--color-success) 22%, transparent)"
                : undefined,
            }}
            aria-hidden="true"
          />
          {connection.authLoading
            ? "Signing in…"
            : connection.authToken
              ? connection.authLogin
                ? `Signed in · ${connection.authLogin}`
                : "Signed in"
              : "Not connected"}
        </span>
      </header>

      <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
        API Base URL
        <input
          className="w-full px-2.5 py-1.5 rounded-md border border-border-default bg-bg-surface text-text-primary"
          value={base}
          onChange={(e) => setBaseUrl(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <p className="m-0 text-[11.5px] text-text-muted">{authStatusNote}</p>

      <div className="flex flex-wrap gap-2">
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

      <div className="flex flex-col gap-1 pt-1">
        <a
          className="text-[11.5px] text-accent hover:underline hover:text-accent-strong"
          href={`${trimmedBase}/site-admin`}
          target="_blank"
          rel="noreferrer"
        >
          Open /site-admin
        </a>
        <a
          className="text-[11.5px] text-accent hover:underline hover:text-accent-strong"
          href={`${trimmedBase}/site-admin/login`}
          target="_blank"
          rel="noreferrer"
        >
          Open /site-admin/login
        </a>
      </div>

      <details
        open={cfExpanded}
        onToggle={(event) => setCfExpanded((event.target as HTMLDetailsElement).open)}
        className="pt-2 border-t border-border-subtle"
      >
        <summary className="cursor-pointer text-[12px] text-text-secondary select-none">
          Cloudflare Access service token · <span className="text-text-muted">disabled server-side</span>
        </summary>
        <div className="flex flex-col gap-2 pt-2">
          <p
            className="m-0 text-[11.5px]"
            style={{ color: "var(--color-warn-text,#8a6d0b)" }}
          >
            ⚠︎ The server is currently running in <code>SITE_ADMIN_AUTH_MODE=legacy</code>
            — CF Access JWTs are ignored. Values saved here won&rsquo;t
            authenticate. Use the browser sign-in button above instead.
          </p>
          <p className="m-0 text-[11.5px] text-text-muted">
            (Kept in the UI for the day we re-enable CF Access. Zero Trust →
            Access → Service Auth → Service Tokens.)
          </p>
          <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
            Client ID
            <input
              className="w-full px-2.5 py-1.5 rounded-md border border-border-default bg-bg-surface text-text-primary"
              value={cfId}
              onChange={(e) => setCfId(e.target.value)}
              placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.access"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
            Client Secret
            <input
              className="w-full px-2.5 py-1.5 rounded-md border border-border-default bg-bg-surface text-text-primary"
              value={cfSecret}
              onChange={(e) => setCfSecret(e.target.value)}
              type={showSecret ? "text" : "password"}
              placeholder="(paste once; stored in keychain)"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <div className="flex flex-wrap gap-2 items-center">
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
            <label className="flex items-center gap-1.5 text-[11.5px] text-text-muted ml-auto">
              <input
                type="checkbox"
                checked={showSecret}
                onChange={(e) => setShowSecret(e.target.checked)}
              />
              Reveal secret
            </label>
          </div>
          {hasCfService && (
            <p className="m-0 text-[11.5px] text-text-muted">
              Stored ID: <code>{connection.cfAccessClientId}</code>
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
