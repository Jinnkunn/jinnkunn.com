import test from "node:test";
import assert from "node:assert/strict";

import {
  mapNavigationRows,
  mapProtectedRouteRows,
  mapRouteOverrideRows,
  mapSiteSettingsRow,
} from "../lib/site-admin/row-mappers.ts";

function title(text) {
  return { type: "title", title: [{ plain_text: text }] };
}

function rich(text) {
  return { type: "rich_text", rich_text: [{ plain_text: text }] };
}

function select(name) {
  return { type: "select", select: { name } };
}

function num(value) {
  return { type: "number", number: value };
}

function checkbox(value) {
  return { type: "checkbox", checkbox: value };
}

test("site-admin-row-mappers: mapSiteSettingsRow maps fields + defaults", () => {
  const row = {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    properties: {
      "Site Name": rich("My Site"),
      Lang: rich(""),
      "SEO Title": rich("SEO"),
      "SEO Description": rich("Description"),
      Favicon: rich("/favicon.ico"),
      "Google Analytics ID": rich("G-XXXX"),
      "Content GitHub Users": rich("alice,bob"),
      "Root Page ID": rich("root1"),
      "Home Page ID": rich("home1"),
    },
  };

  const actual = mapSiteSettingsRow(row);
  assert.deepEqual(actual, {
    rowId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    siteName: "My Site",
    lang: "en",
    seoTitle: "SEO",
    seoDescription: "Description",
    favicon: "/favicon.ico",
    googleAnalyticsId: "G-XXXX",
    contentGithubUsers: "alice,bob",
    rootPageId: "root1",
    homePageId: "home1",
  });
});

test("site-admin-row-mappers: mapNavigationRows sorts by group then order", () => {
  const rows = [
    {
      id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      properties: {
        Label: rich("Works"),
        Href: rich("/works"),
        Group: select("top"),
        Order: num(3),
        Enabled: checkbox(true),
      },
    },
    {
      id: "cccccccccccccccccccccccccccccccc",
      properties: {
        Name: title("Blog"),
        Href: rich("/blog"),
        Group: select("more"),
        Order: num(1),
        Enabled: checkbox(true),
      },
    },
    {
      id: "dddddddddddddddddddddddddddddddd",
      properties: {
        Label: rich("Home"),
        Href: rich("/"),
        Group: select("top"),
        Order: num(1),
      },
    },
  ];

  const actual = mapNavigationRows(rows);
  assert.deepEqual(
    actual.map((x) => ({ label: x.label, group: x.group, order: x.order, enabled: x.enabled })),
    [
      { label: "Home", group: "top", order: 1, enabled: true },
      { label: "Works", group: "top", order: 3, enabled: true },
      { label: "Blog", group: "more", order: 1, enabled: true },
    ],
  );
});

test("site-admin-row-mappers: mapRouteOverrideRows keeps enabled rows with normalized paths", () => {
  const rows = [
    {
      id: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      properties: {
        "Page ID": rich("ffffffffffffffffffffffffffffffff"),
        "Route Path": rich("news/latest/"),
        Enabled: checkbox(true),
      },
    },
    {
      id: "99999999999999999999999999999999",
      properties: {
        "Page ID": rich("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        "Route Path": rich("/hidden"),
        Enabled: checkbox(false),
      },
    },
  ];

  assert.deepEqual(mapRouteOverrideRows(rows), [
    {
      rowId: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      pageId: "ffffffffffffffffffffffffffffffff",
      routePath: "/news/latest",
      enabled: true,
    },
  ]);
});

test("site-admin-row-mappers: mapProtectedRouteRows parses mode/auth and skips invalid path", () => {
  const rows = [
    {
      id: "12121212121212121212121212121212",
      properties: {
        "Page ID": rich("13131313131313131313131313131313"),
        Path: rich("teaching"),
        Mode: select("Prefix"),
        Auth: select("GitHub"),
        Enabled: checkbox(true),
      },
    },
    {
      id: "14141414141414141414141414141414",
      properties: {
        "Page ID": rich("15151515151515151515151515151515"),
        Path: rich(" "),
        Mode: select("Exact"),
        Auth: select("Password"),
      },
    },
  ];

  assert.deepEqual(mapProtectedRouteRows(rows), [
    {
      rowId: "12121212121212121212121212121212",
      pageId: "13131313131313131313131313131313",
      path: "/teaching",
      mode: "prefix",
      auth: "github",
      enabled: true,
    },
  ]);
});
