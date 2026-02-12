export function StatusBadge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={ok ? "site-admin-badge site-admin-badge--ok" : "site-admin-badge site-admin-badge--bad"}>
      {children}
    </span>
  );
}
