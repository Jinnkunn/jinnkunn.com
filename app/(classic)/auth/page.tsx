import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Protected",
  description: "Password required",
};

export const dynamic = "force-dynamic";

function normalizeNextPath(p: string | null): string {
  const raw = String(p || "").trim();
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  // Basic hardening: keep it a path, not a full URL.
  if (raw.startsWith("//")) return "/";
  return raw;
}

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; rid?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const nextPath = normalizeNextPath(sp.next ?? null);
  const rid = String(sp.rid ?? "").trim();
  const error = String(sp.error ?? "").trim();

  return (
    <main id="page-auth" className="super-content page__auth parent-page__index">
      <div className="notion-header page">
        <div className="notion-header__cover no-cover no-icon" />
        <div className="notion-header__content max-width no-cover no-icon">
          <div className="notion-header__title-wrapper">
            <h1 className="notion-header__title">Password Required</h1>
          </div>
        </div>
      </div>

      <article id="block-auth" className="notion-root max-width has-footer">
        {error ? (
          <p className="notion-text notion-text__content notion-semantic-string">
            <span className="highlighted-color color-red">
              Incorrect password. Please try again.
            </span>
          </p>
        ) : null}

        <form method="post" action="/api/site-auth" className="notion-form">
          <input type="hidden" name="next" value={nextPath} />
          <input type="hidden" name="rid" value={rid} />

          <div className="notion-text notion-text__content notion-semantic-string">
            <label htmlFor="password">Password</label>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              style={{
                flex: 1,
                minWidth: 0,
                height: 40,
                borderRadius: 10,
                border: "1px solid var(--color-border-default)",
                padding: "0 12px",
                background: "var(--color-card-bg)",
                color: "var(--color-text-default)",
              }}
            />
            <button
              type="submit"
              style={{
                height: 40,
                borderRadius: 10,
                border: "1px solid var(--color-border-default)",
                padding: "0 14px",
                background: "var(--color-card-bg)",
                color: "var(--color-text-default)",
                cursor: "pointer",
              }}
            >
              Unlock
            </button>
          </div>
        </form>
      </article>
    </main>
  );
}
