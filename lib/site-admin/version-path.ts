// Which repo paths `/api/site-admin/versions` may read and restore.
//
// Lives outside the route so the rules stay derived from the content types'
// own validators instead of a bespoke regex: post slugs run to 120 chars and
// page slugs are hierarchical ("docs/api/auth"), so a local
// `[a-z0-9-]{1,80}` pattern silently 400s real files.

import { isValidPageSlug } from "../pages/slug.ts";
import { isValidSlug } from "../posts/slug.ts";
import { isSiteComponentName } from "./component-registry.ts";

/** Structured content files edited through their own panels but versioned
 * like any other source file. */
const STRUCTURED_CONTENT = new Set([
  "content/home.json",
  "content/now.json",
]);

const MDX_PATH_RE = /^content\/(posts|pages|components)\/(.+)\.mdx$/;

/** Returns the canonical repo-relative path, or "" when the caller asked for
 * something outside the versionable set. The slug validators also reject
 * traversal segments, so the "" check is the route's only path guard. */
export function normalizeSiteAdminVersionPath(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().replace(/^\/+/, "") : "";
  if (STRUCTURED_CONTENT.has(value)) return value;
  const match = MDX_PATH_RE.exec(value);
  if (!match) return "";
  const [, kind, slug] = match;
  if (kind === "posts") return isValidSlug(slug) ? value : "";
  if (kind === "pages") return isValidPageSlug(slug) ? value : "";
  return isSiteComponentName(slug) ? value : "";
}
