let warned = false;

/**
 * When enabled, Site Admin reads and writes structured content (config, nav,
 * routes) under `content/local/`, which is gitignored. That is useful for local
 * experiments, but it is also how the local tree silently drifts from the
 * committed one — `content/local/site-config.json` has already diverged from
 * `content/filesystem/site-config.json`, so local QA validates a different site
 * than the one that ships.
 *
 * The default is deliberately unchanged (on in development): flipping it would
 * change an established local workflow. Instead the first call announces the
 * write target so the drift can no longer be invisible.
 */
export function localContentOverridesEnabled(): boolean {
  const raw = String(process.env.SITE_CONTENT_LOCAL_OVERRIDES || "").trim();
  let enabled: boolean;
  if (raw === "1" || raw.toLowerCase() === "true") enabled = true;
  else if (raw === "0" || raw.toLowerCase() === "false") enabled = false;
  else enabled = process.env.NODE_ENV === "development";

  if (enabled && !warned && raw === "") {
    warned = true;
    console.warn(
      "[site-admin] local content overrides are ON (implied by NODE_ENV=development). " +
        "Structured content reads/writes go to gitignored content/local/ and will NOT " +
        "reach git or any deploy. Set SITE_CONTENT_LOCAL_OVERRIDES=0 to edit the " +
        "committed content/filesystem/ copy instead.",
    );
  }
  return enabled;
}

/** Test seam: lets a test observe the first-call warning more than once. */
export function resetLocalContentOverridesWarning(): void {
  warned = false;
}
