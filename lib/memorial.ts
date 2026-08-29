import type { SiteConfig } from "@/lib/site-config";

export type MemorialConfig = SiteConfig["memorial"];

function timestamp(raw: string, endOfDay = false): number | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = Date.parse(dateOnly ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}-03:00` : value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getActiveMemorial(
  config: MemorialConfig,
  now: Date = new Date(),
): MemorialConfig | null {
  if (!config.enabled || !config.title.trim()) return null;
  const nowMs = now.getTime();
  const startsAt = timestamp(config.startsAt);
  const endsAt = timestamp(config.endsAt, true);
  if (startsAt !== null && nowMs < startsAt) return null;
  if (endsAt !== null && nowMs > endsAt) return null;
  return config;
}
