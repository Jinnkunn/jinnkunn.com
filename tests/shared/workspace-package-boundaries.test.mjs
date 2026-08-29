import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  normalizePublicCalendarData as normalizePublicCalendarDataFromPackage,
} from "@jinnkunn/calendar-core/public";
import {
  parseSiteAdminCalendarPublicSaveCommand,
} from "@jinnkunn/contracts/calendar-commands";
import {
  siteAdminConfigCommandInputSchema,
  siteAdminRoutesCommandInputSchema,
} from "@jinnkunn/contracts/schemas";
import {
  DocumentPathError,
  normalizeDocumentPath,
  toContentDocumentPath,
} from "@jinnkunn/document-repository/path";
import {
  normalizeTauriApiResponse,
  parsePageListRow,
  unwrapSiteAdminApiEnvelope,
} from "@jinnkunn/site-admin-client/transport";
import {
  normalizePublicCalendarData as normalizePublicCalendarDataFromFacade,
} from "../../lib/shared/public-calendar.ts";

const ROOT = process.cwd();
const SHARED_PACKAGE_NAMES = [
  "@jinnkunn/calendar-core",
  "@jinnkunn/contracts",
  "@jinnkunn/content-core",
  "@jinnkunn/document-repository",
  "@jinnkunn/site-admin-client",
];
const COMPATIBILITY_FACADES = [
  "lib/client/api-guards.ts",
  "lib/pages/meta.ts",
  "lib/pages/types.ts",
  "lib/posts/meta.ts",
  "lib/posts/types.ts",
  "lib/shared/access.ts",
  "lib/shared/calendar-core.ts",
  "lib/shared/calendar-ics.ts",
  "lib/shared/calendar-tags.ts",
  "lib/shared/calendar-timezone.ts",
  "lib/shared/public-calendar.ts",
  "lib/site-admin/api-types.ts",
  "lib/site-admin/backend-client.ts",
  "lib/site-admin/calendar-observation-commands.ts",
  "lib/site-admin/calendar-public-commands.ts",
  "lib/site-admin/component-registry.ts",
  "lib/site-admin/config-contract.ts",
  "lib/site-admin/content-contract.ts",
  "lib/site-admin/contract-helpers.ts",
  "lib/site-admin/deploy-contract.ts",
  "lib/site-admin/deploy-preview-contract.ts",
  "lib/site-admin/home-normalize.ts",
  "lib/site-admin/now-normalize.ts",
  "lib/site-admin/request-types.ts",
  "lib/site-admin/routes-contract.ts",
  "lib/site-admin/status-contract.ts",
  "lib/site-admin/types.ts",
];

function dependencyVersion(pkg, name) {
  return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? "";
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(ROOT, relativePath), "utf8"));
}

async function listSourceFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(absolute)));
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
}

test("shared packages: compatibility facades execute the canonical implementation", () => {
  assert.equal(
    normalizePublicCalendarDataFromFacade,
    normalizePublicCalendarDataFromPackage,
  );

  const parsed = parseSiteAdminCalendarPublicSaveCommand({
    data: {
      generatedAt: "2026-08-29T12:00:00.000Z",
      range: {
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: "2026-09-01T00:00:00.000Z",
      },
      events: [],
    },
    expectedFileSha: " sha-1 ",
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.expectedFileSha, "sha-1");
});

test("shared packages: compatibility facades contain exports only", async () => {
  for (const relativePath of COMPATIBILITY_FACADES) {
    const source = (await fs.readFile(path.join(ROOT, relativePath), "utf8")).trim();
    assert.match(source, /^export\s/, relativePath);
    assert.doesNotMatch(
      source,
      /\b(?:function|class|const|let|interface)\b/,
      `${relativePath} must not regain implementation logic`,
    );
  }
});

test("shared packages: Site Admin transport decodes one envelope shape", () => {
  const normalized = normalizeTauriApiResponse({
    status: 200,
    body: { ok: true, data: { value: 1 } },
  });
  assert.deepEqual(normalized, {
    ok: true,
    status: 200,
    data: { value: 1 },
    raw: { ok: true, data: { value: 1 } },
  });

  assert.deepEqual(
    unwrapSiteAdminApiEnvelope({
      ok: false,
      code: "SOURCE_CONFLICT",
      error: "Reload before saving.",
    }),
    {
      ok: false,
      code: "SOURCE_CONFLICT",
      error: "Reload before saving.",
    },
  );

  assert.equal(parsePageListRow({ title: "Missing slug" }), null);
  assert.deepEqual(parsePageListRow({ slug: "bio", title: "Biography" }), {
    slug: "bio",
    href: "/pages/bio",
    title: "Biography",
    description: null,
    updatedIso: null,
    draft: false,
    wordCount: 0,
    readingMinutes: 0,
    version: "",
  });
});

test("shared packages: config and routes reject commands outside the allowlist", () => {
  assert.equal(
    siteAdminConfigCommandInputSchema.safeParse({ kind: "delete-everything" }).success,
    false,
  );
  assert.equal(
    siteAdminRoutesCommandInputSchema.safeParse({ kind: "shell" }).success,
    false,
  );
  assert.equal(
    siteAdminConfigCommandInputSchema.safeParse({
      kind: "settings",
      rowId: "row-1",
      patch: { siteName: "Jinkun Chen" },
      expectedSiteConfigSha: "sha-1",
    }).success,
    true,
  );
});

test("shared packages: document paths use one content-root vocabulary", () => {
  assert.equal(normalizeDocumentPath("/pages/bio.mdx"), "pages/bio.mdx");
  assert.equal(toContentDocumentPath("content/pages/bio.mdx"), "pages/bio.mdx");
  assert.throws(
    () => normalizeDocumentPath("../secrets.env"),
    DocumentPathError,
  );
});

test("shared packages: Web and Workspace dependencies stay aligned", async () => {
  const rootPackage = await readJson("package.json");
  const workspacePackage = await readJson("apps/workspace/package.json");

  for (const packageName of SHARED_PACKAGE_NAMES) {
    assert.match(dependencyVersion(rootPackage, packageName), /^file:packages\//);
    assert.match(
      dependencyVersion(workspacePackage, packageName),
      /^file:\.\.\/\.\.\/packages\//,
    );
  }

  assert.equal(rootPackage.dependencies.react, workspacePackage.dependencies.react);
  assert.equal(rootPackage.dependencies["react-dom"], workspacePackage.dependencies["react-dom"]);
  assert.equal(
    rootPackage.dependencies.next,
    rootPackage.devDependencies["@next/bundle-analyzer"],
  );
});

test("shared packages: Workspace does not reach back into Web contract files", async () => {
  const sourceRoot = path.join(ROOT, "apps/workspace/src");
  const files = await listSourceFiles(sourceRoot);
  const violations = [];
  const forbiddenImport = /\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/lib\/(?:shared\/calendar|site-admin\/(?:api-types|types|calendar|component-registry|.*contract))/;

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    if (forbiddenImport.test(source)) {
      violations.push(path.relative(ROOT, file).split(path.sep).join("/"));
    }
  }

  assert.deepEqual(violations, []);
});
