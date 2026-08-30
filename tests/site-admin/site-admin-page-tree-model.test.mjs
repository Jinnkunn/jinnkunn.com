import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPageTree,
  orderPageTreeItems,
  pageBreadcrumb,
  pagePathLabel,
} from "../../app/site-admin/site-admin-page-tree-model.ts";

const pages = [
  { id: "bio", title: "BIO" },
  { id: "teaching/archive/2024-25-fall/csci3141", title: "CSCI3141" },
  { id: "teaching", title: "Teaching" },
  { id: "teaching/archive", title: "Archive" },
  { id: "teaching/archive/2024-25-fall", title: "2024/25 Fall" },
  { id: "publications", title: "Publications" },
];

test("page tree preserves the saved pre-order and nests slash-delimited pages", () => {
  const order = [
    "publications",
    "teaching",
    "teaching/archive",
    "teaching/archive/2024-25-fall",
    "teaching/archive/2024-25-fall/csci3141",
  ];
  const tree = buildPageTree(pages, order);

  assert.deepEqual(tree.map((node) => node.slug), ["publications", "teaching", "bio"]);
  assert.equal(tree[1].children[0].title, "Archive");
  assert.equal(tree[1].children[0].children[0].title, "2024/25 Fall");
  assert.equal(tree[1].children[0].children[0].children[0].title, "CSCI3141");
});

test("page tree keeps virtual parents when a parent page does not exist", () => {
  const tree = buildPageTree([{ id: "research/projects/atlas", title: "Atlas" }]);
  assert.equal(tree[0].title, "Research");
  assert.equal(tree[0].item, null);
  assert.equal(tree[0].children[0].title, "Projects");
  assert.equal(tree[0].children[0].children[0].title, "Atlas");
});

test("unordered pages append once in stable slug order", () => {
  const ordered = orderPageTreeItems(pages, ["teaching", "teaching", "missing"]);
  assert.equal(ordered[0].id, "teaching");
  assert.deepEqual(
    ordered.slice(1).map((item) => item.id),
    pages
      .map((item) => item.id)
      .filter((slug) => slug !== "teaching")
      .sort((a, b) => a.localeCompare(b)),
  );
});

test("breadcrumbs use page titles instead of exposing only raw slug segments", () => {
  assert.deepEqual(
    pageBreadcrumb("teaching/archive/2024-25-fall/csci3141", pages),
    [
      { slug: "teaching", title: "Teaching" },
      { slug: "teaching/archive", title: "Archive" },
      { slug: "teaching/archive/2024-25-fall", title: "2024/25 Fall" },
      { slug: "teaching/archive/2024-25-fall/csci3141", title: "CSCI3141" },
    ],
  );
  assert.equal(
    pagePathLabel("teaching/archive/2024-25-fall/csci3141", pages),
    "Teaching / Archive / 2024/25 Fall / CSCI3141",
  );
});
