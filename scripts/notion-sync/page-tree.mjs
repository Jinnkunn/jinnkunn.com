import path from "node:path";

import {
  getDatabaseInfo,
  getDatabaseParentPageId,
  listBlockChildrenCached,
  queryDatabase,
} from "../../lib/notion/index.mjs";
import { compactId } from "../../lib/shared/route-utils.mjs";
import { readJsonFile, writeJsonAtomic } from "./fs-utils.mjs";
import { extractFirstDateProperty } from "./date-utils.mjs";
import { getPageInfo, getTitleFromPageObject } from "./page-meta.mjs";

function cacheFile(cacheDir, kind, id) {
  const safeKind = String(kind || "misc").replace(/[^a-z0-9_-]/gi, "_");
  const safeId = String(id || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return path.join(cacheDir, safeKind, `${safeId}.json`);
}

function stripTreeForCache(value) {
  // Drop heavy Notion API objects that we don't need for routing/tree reuse.
  // Rendering uses a separate cache (page-render) keyed by last_edited_time.
  return JSON.parse(
    JSON.stringify(value, (k, v) => {
      if (k === "__page") return undefined;
      return v;
    }),
  );
}

export function createPageTreeBuilder({
  cacheDir,
  cacheEnabled,
  cacheForce,
}) {
  async function buildPageTree(
    parentPageId,
    {
      seenDatabases,
    } = {},
  ) {
    const seenDb = seenDatabases || new Set();

    const pid = compactId(parentPageId);
    let pageLastEdited = "";
    if (cacheEnabled && !cacheForce && pid) {
      try {
        const info = await getPageInfo(pid);
        const lastEdited = info.lastEdited || "";
        pageLastEdited = lastEdited;
        if (lastEdited) {
          const file = cacheFile(cacheDir, "page-tree", pid);
          const cached = readJsonFile(file);
          const cachedEdited = cached?.lastEdited ? String(cached.lastEdited) : "";
          if (cached && cachedEdited && cachedEdited === lastEdited && Array.isArray(cached.children)) {
            // Ensure any databases in the cached subtree are marked as seen, otherwise later
            // traversals could re-include them.
            const stack = [...cached.children];
            while (stack.length) {
              const n = stack.pop();
              if (!n || typeof n !== "object") continue;
              if (n.kind === "database" && n.id) seenDb.add(String(n.id));
              if (Array.isArray(n.children)) stack.push(...n.children);
            }
            return cached.children;
          }
        }
      } catch {
        // ignore cache failures
      }
    }

    // Scan recursively so we discover child pages/databases nested inside toggles/columns/callouts/etc.
    const blocks = await (async () => {
      const top = await listBlockChildrenCached(parentPageId);
      const stack = [...top].reverse();
      const out = [];
      const seen = new Set(); // block id

      while (stack.length) {
        const b = stack.pop();
        if (!b || !b.id) continue;
        const bid = compactId(b.id);
        if (bid && seen.has(bid)) continue;
        if (bid) seen.add(bid);

        out.push(b);

        // IMPORTANT: don't expand child_page/child_database here. We treat them as
        // nodes and recurse using their canonical ids, otherwise we "inline" the
        // subtree at the wrong parent and duplicate routes.
        const t = String(b?.type || "");
        if (b?.has_children && t !== "child_page" && t !== "child_database") {
          const kids = await listBlockChildrenCached(b.id);
          // Preserve Notion order: parent, then its children, then next sibling.
          for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
        }
      }

      return out;
    })();

    const out = [];

    for (const b of blocks) {
      if (b?.type === "child_page" && b?.child_page?.title) {
        const node = {
          kind: "page",
          id: compactId(b.id),
          title: b.child_page.title,
          children: [],
          parentId: compactId(parentPageId),
          routePath: "",
          routeSegments: [],
        };
        node.children = await buildPageTree(node.id, { seenDatabases: seenDb });
        out.push(node);
        continue;
      }

      if (b?.type === "child_database") {
        const dbId = compactId(b.id);
        const title = String(b.child_database?.title ?? "").trim() || "Database";

        // If this database's canonical parent is another page, this is a linked view.
        // Skip it to avoid duplicating routes (Super-like behavior).
        if (dbId) {
          const canonicalParent = await getDatabaseParentPageId(dbId);
          if (canonicalParent && canonicalParent !== compactId(parentPageId)) {
            continue;
          }
          if (seenDb.has(dbId)) continue;
          seenDb.add(dbId);
        }

        // Database caching: databases can change (rows added/edited) without the parent page changing.
        // Cache the rendered tree for the database keyed by Notion database `last_edited_time`.
        let dbLastEdited = "";
        if (cacheEnabled && !cacheForce && dbId) {
          try {
            const info = await getDatabaseInfo(dbId);
            dbLastEdited = info.lastEdited || "";
            if (dbLastEdited) {
              const file = cacheFile(cacheDir, "db-tree", dbId);
              const cached = readJsonFile(file);
              const cachedEdited = cached?.lastEdited ? String(cached.lastEdited) : "";
              if (cached && cachedEdited && cachedEdited === dbLastEdited && cached.node) {
                const node = cached.node;
                // Ensure parent pointers are consistent (defensive).
                node.parentId = compactId(parentPageId);
                out.push(node);
                continue;
              }
            }
          } catch {
            // ignore db cache failures
          }
        }

        const rows = await queryDatabase(dbId);
        const items = rows
          .filter((p) => !p?.archived && !p?.in_trash)
          .map((p) => {
            const date = extractFirstDateProperty(p, { timeZone: "UTC" });
            return {
              kind: "page",
              id: compactId(p.id),
              title: getTitleFromPageObject(p),
              children: [],
              parentId: dbId,
              routePath: "",
              routeSegments: [],
              __page: p,
              __date: date,
            };
          });

        // Match Super's "newest first" behavior when a Date property exists.
        items.sort((a, b) => {
          const ai = a.__date?.iso || "";
          const bi = b.__date?.iso || "";
          if (ai && bi) return ai < bi ? 1 : ai > bi ? -1 : 0;
          if (ai && !bi) return -1;
          if (!ai && bi) return 1;
          return a.title.localeCompare(b.title);
        });

        for (const it of items) {
          it.children = await buildPageTree(it.id, { seenDatabases: seenDb });
        }

        const dbNode = {
          kind: "database",
          id: dbId,
          title,
          children: items,
          parentId: compactId(parentPageId),
          routePath: "",
          routeSegments: [],
        };
        out.push(dbNode);

        if (cacheEnabled && !cacheForce && dbId) {
          try {
            if (!dbLastEdited) dbLastEdited = (await getDatabaseInfo(dbId)).lastEdited || "";
            if (dbLastEdited) {
              writeJsonAtomic(cacheFile(cacheDir, "db-tree", dbId), {
                lastEdited: dbLastEdited,
                node: stripTreeForCache(dbNode),
              });
            }
          } catch {
            // ignore cache write failures
          }
        }
      }
    }

    if (cacheEnabled && !cacheForce && pid) {
      try {
        let lastEdited = pageLastEdited;
        if (!lastEdited) lastEdited = (await getPageInfo(pid)).lastEdited || "";
        if (lastEdited) {
          writeJsonAtomic(cacheFile(cacheDir, "page-tree", pid), {
            lastEdited,
            children: stripTreeForCache(out),
          });
        }
      } catch {
        // ignore cache write errors
      }
    }

    return out;
  }

  return buildPageTree;
}
