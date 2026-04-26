import "server-only";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return defaultValue;
  if (TRUE_VALUES.has(raw)) return true;
  if (FALSE_VALUES.has(raw)) return false;
  return defaultValue;
}

export async function searchRichSnippetsFlag(): Promise<boolean> {
  return envFlag("FLAG_SEARCH_RICH_SNIPPETS", true);
}

export async function siteAdminStatusBannerFlag(): Promise<boolean> {
  return envFlag("FLAG_SITE_ADMIN_STATUS_BANNER", true);
}
