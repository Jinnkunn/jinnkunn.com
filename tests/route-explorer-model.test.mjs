import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRouteTree,
  computeVisibleRoutes,
  createEffectiveAccessFinder,
  createOverrideConflictFinder,
  getDefaultCollapsed,
  parseAdminRoutesPayload,
} from "../lib/site-admin/route-explorer-model.ts";

function route(overrides) {
  return {
    id: "",
    title: "",
    kind: "page",
    routePath: "/",
    parentId: "",
    parentRoutePath: "/",
    navGroup: "",
    overridden: false,
    ...overrides,
  };
}

function fixtureItems() {
  const homeId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const teachingId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const archiveId = "cccccccccccccccccccccccccccccccc";
  const termId = "dddddddddddddddddddddddddddddddd";

  const home = route({ id: homeId, title: "Home", routePath: "/" });
  const teaching = route({
    id: teachingId,
    title: "Teaching",
    routePath: "/teaching",
    parentId: homeId,
    parentRoutePath: "/",
  });
  const archive = route({
    id: archiveId,
    title: "Archive",
    routePath: "/teaching/archive",
    parentId: teachingId,
    parentRoutePath: "/teaching",
  });
  const term = route({
    id: termId,
    title: "2024/25 Fall",
    routePath: "/teaching/archive/2024-25-fall",
    parentId: archiveId,
    parentRoutePath: "/teaching/archive",
  });
  return { home, teaching, archive, term, ids: { homeId, teachingId, archiveId, termId }, items: [home, teaching, archive, term] };
}

test("route-explorer-model: buildRouteTree keeps explicit parent hierarchy + depth", () => {
  const { items, ids } = fixtureItems();
  const tree = buildRouteTree(items);

  assert.equal(tree.parentById.get(ids.teachingId), ids.homeId);
  assert.equal(tree.parentById.get(ids.archiveId), ids.teachingId);
  assert.equal(tree.parentById.get(ids.termId), ids.archiveId);

  const byId = new Map(tree.ordered.map((it) => [it.id, it]));
  assert.equal(byId.get(ids.homeId)?.depth, 0);
  assert.equal(byId.get(ids.teachingId)?.depth, 1);
  assert.equal(byId.get(ids.archiveId)?.depth, 2);
  assert.equal(byId.get(ids.termId)?.depth, 3);
});

test("route-explorer-model: getDefaultCollapsed collapses depth>=1 parents only", () => {
  const { items, ids } = fixtureItems();
  const tree = buildRouteTree(items);
  const collapsed = getDefaultCollapsed(tree.ordered);

  assert.equal(collapsed[ids.homeId], undefined, "root should stay expanded");
  assert.equal(collapsed[ids.teachingId], true, "depth-1 parent should start collapsed");
  assert.equal(collapsed[ids.archiveId], true, "depth-2 parent should start collapsed");
  assert.equal(collapsed[ids.termId], undefined, "leaf should not be in collapsed map");
});

test("route-explorer-model: computeVisibleRoutes respects collapsed ancestors", () => {
  const { items, ids: fixtureIds } = fixtureItems();
  const tree = buildRouteTree(items);
  const filtered = tree.ordered;

  const visible = computeVisibleRoutes({
    filtered,
    collapsed: { [fixtureIds.teachingId]: true },
    q: "",
    parentById: tree.parentById,
  });

  const visibleIds = visible.map((it) => it.id);
  assert.deepEqual(visibleIds, [fixtureIds.homeId, fixtureIds.teachingId]);
});

test("route-explorer-model: search mode bypasses collapse hiding", () => {
  const { items, ids } = fixtureItems();
  const tree = buildRouteTree(items);
  const filtered = tree.ordered.filter((it) => it.id !== ids.homeId);

  const visible = computeVisibleRoutes({
    filtered,
    collapsed: { [ids.teachingId]: true, [ids.archiveId]: true },
    q: "fall",
    parentById: tree.parentById,
  });

  assert.deepEqual(
    visible.map((it) => it.id),
    filtered.map((it) => it.id),
  );
});

test("route-explorer-model: createEffectiveAccessFinder supports direct + inherited protection", () => {
  const { items, ids } = fixtureItems();
  const tree = buildRouteTree(items);
  const finder = createEffectiveAccessFinder({
    items,
    tree,
    cfg: {
      overrides: {},
      protectedByPageId: {
        [ids.teachingId]: { auth: "github", mode: "prefix", path: "/teaching" },
      },
    },
  });

  const direct = finder(ids.teachingId, "/teaching");
  assert.equal(direct?.direct, true);
  assert.equal(direct?.inherited, false);
  assert.equal(direct?.auth, "github");
  assert.equal(direct?.sourceId, ids.teachingId);

  const inherited = finder(ids.termId, "/teaching/archive/2024-25-fall");
  assert.equal(inherited?.direct, false);
  assert.equal(inherited?.inherited, true);
  assert.equal(inherited?.auth, "github");
  assert.equal(inherited?.sourceId, ids.teachingId);
});

test("route-explorer-model: parseAdminRoutesPayload maps protection rows by page id", () => {
  const { items, ids } = fixtureItems();
  const parsed = parseAdminRoutesPayload(
    {
      overrides: [{ pageId: ids.termId, routePath: "/fall" }],
      protectedRoutes: [
        { pageId: ids.teachingId, path: "/teaching", mode: "prefix", auth: "github" },
      ],
    },
    items,
  );

  assert.equal(parsed.overrides[ids.termId], "/fall");
  assert.deepEqual(parsed.protectedByPageId[ids.teachingId], {
    auth: "github",
    mode: "prefix",
    path: "/teaching",
  });
});

test("route-explorer-model: createOverrideConflictFinder detects duplicate effective routes", () => {
  const { items, ids } = fixtureItems();
  const findConflict = createOverrideConflictFinder({
    items,
    overrides: {
      [ids.termId]: "/teaching",
    },
  });

  const conflict = findConflict(ids.termId, "/teaching");
  assert.equal(conflict?.path, "/teaching");
  assert.equal(conflict?.count, 1);
  assert.equal(conflict?.others[0]?.id, ids.teachingId);

  assert.equal(findConflict(ids.termId, "/teaching/archive/2024-25-fall"), null);
});
