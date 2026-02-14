import path from "node:path";

import { writeFile } from "./fs-utils.mjs";
import { normalizeHref } from "./page-meta.mjs";

export function buildRouteManifest(allPages, cfg, routeOverrides) {
  const navHrefToGroup = new Map();
  for (const it of cfg?.nav?.top || []) navHrefToGroup.set(normalizeHref(it.href), "top");
  for (const it of cfg?.nav?.more || []) navHrefToGroup.set(normalizeHref(it.href), "more");

  return allPages.map((p) => {
    const navGroup = navHrefToGroup.get(p.routePath) || "";
    const overridden = routeOverrides.has(p.id);
    return {
      id: p.id,
      title: p.title,
      kind: p.kind,
      routePath: p.routePath,
      parentId: p.parentId,
      parentRoutePath: p.parentRoutePath || "/",
      navGroup,
      overridden,
    };
  });
}

export function writeSyncArtifacts({
  outDir,
  allPages,
  cfg,
  routeOverrides,
  searchIndex,
}) {
  writeFile(
    path.join(outDir, "search-index.json"),
    // Keep it compact; this file is parsed on demand by /api/search.
    JSON.stringify(searchIndex) + "\n",
  );

  // Small debug artifact: route map.
  const routes = Object.fromEntries(allPages.map((p) => [p.routePath, p.id]));
  writeFile(path.join(outDir, "routes.json"), JSON.stringify(routes, null, 2) + "\n");

  // Route explorer manifest (used by /__routes).
  const routeManifest = buildRouteManifest(allPages, cfg, routeOverrides);
  writeFile(
    path.join(outDir, "routes-manifest.json"),
    JSON.stringify(routeManifest, null, 2) + "\n",
  );
}
