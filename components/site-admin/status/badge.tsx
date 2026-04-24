import { Badge } from "@/components/ui/badge";

export function StatusBadge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <Badge tone={ok ? "success" : "danger"}>{children}</Badge>;
}
