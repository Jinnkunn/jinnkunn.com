const GA4_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{10}$/;

export function normalizeGoogleAnalyticsId(input: unknown): string | null {
  const raw = typeof input === "string" ? input.trim().toUpperCase() : "";
  if (!raw) return "";
  return GA4_MEASUREMENT_ID_PATTERN.test(raw) ? raw : null;
}

export function isGoogleAnalyticsId(input: unknown): boolean {
  const normalized = normalizeGoogleAnalyticsId(input);
  return Boolean(normalized);
}

export function buildGoogleAnalyticsInitScript(input: unknown): string {
  const measurementId = normalizeGoogleAnalyticsId(input);
  if (!measurementId) return "";
  return [
    "window.dataLayer = window.dataLayer || [];",
    "function gtag(){dataLayer.push(arguments);}",
    "gtag('js', new Date());",
    `gtag('config', ${JSON.stringify(measurementId)}, { anonymize_ip: true });`,
  ].join("\n");
}
