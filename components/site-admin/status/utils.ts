export function fmtWhen(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return "—";
  }
}

export function fmtIso(iso?: string | null): string {
  const s = String(iso || "").trim();
  if (!s) return "—";
  return s.replace("T", " ").replace("Z", " UTC");
}
