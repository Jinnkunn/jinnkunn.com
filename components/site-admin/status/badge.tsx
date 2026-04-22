import { Badge } from "@/components/ui/badge";

export function StatusBadge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <Badge
      className={ok ? "site-admin-badge site-admin-badge--ok" : "site-admin-badge site-admin-badge--bad"}
      tone={ok ? "success" : "danger"}
    >
      {children}
    </Badge>
  );
}
