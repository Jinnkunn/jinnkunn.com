/** Placeholder for a future calendar integration. Lives here so the
 * sidebar nav already shows a second entry — which makes it obvious to
 * new readers that the shell is multi-surface, not site-admin-only. */
export function CalendarSurface() {
  return (
    <section className="surface-card">
      <header>
        <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
          Calendar
        </h1>
        <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
          Placeholder — this surface will later connect to a calendar provider and
          show upcoming events alongside site-admin tasks.
        </p>
      </header>
      <p className="text-[13px] text-text-secondary">
        When implemented, this surface will own its own connection card (provider
        URL + OAuth credentials) and persist tokens through the
        <code className="mx-1 px-1 py-0.5 rounded bg-bg-surface-alt text-[12px]">
          createNamespacedSecureStorage("calendar")
        </code>
        namespace, keeping credentials isolated from other tools.
      </p>
    </section>
  );
}
