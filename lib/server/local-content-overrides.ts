export function localContentOverridesEnabled(): boolean {
  const raw = String(process.env.SITE_CONTENT_LOCAL_OVERRIDES || "").trim();
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  return process.env.NODE_ENV === "development";
}
