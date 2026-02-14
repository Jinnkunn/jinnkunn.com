import { slugify } from "../shared/route-utils.mjs";
import { findChildDatabases } from "./block-children-cache.mjs";

/**
 * Re-exported so API routes and scripts can share the same behavior.
 */
export { findChildDatabases };

/**
 * @param {Array<{ id: string, title: string }>} dbs
 * @param {string} title
 * @returns {{ id: string, title: string } | null}
 */
export function findDbByTitle(dbs, title) {
  const want = slugify(title);
  return dbs.find((d) => slugify(d.title) === want) || null;
}
