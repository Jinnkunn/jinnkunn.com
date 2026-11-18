import type { SiteConfig } from "@/lib/site-config";
import { presentationTimestamp } from "./shared/presentation-time.ts";

export type MonochromeAppearance = SiteConfig["appearance"]["monochrome"];

export function getActiveMonochromeAppearance(
  config: MonochromeAppearance,
  now: Date = new Date(),
): MonochromeAppearance | null {
  if (!config.enabled) return null;
  const nowMs = now.getTime();
  const startsAt = presentationTimestamp(config.startsAt);
  const endsAt = presentationTimestamp(config.endsAt, true);
  if (startsAt !== null && nowMs < startsAt) return null;
  if (endsAt !== null && nowMs > endsAt) return null;
  return config;
}
