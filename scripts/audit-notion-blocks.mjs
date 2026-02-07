import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const RAW_DIR = path.join(process.cwd(), "content", "raw");
const OUT_DIR = path.join(process.cwd(), "output", "notion-block-audit");

function isoStampForPath(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-");
}

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await walk(p)));
      continue;
    }
    if (ent.isFile()) out.push(p);
  }
  return out;
}

function add(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function pickClassTokens(classValue) {
  // "a  b\tc" -> ["a","b","c"]
  return classValue
    .split(/\s+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isNotionOrSuperClass(token) {
  return token.startsWith("notion-") || token.startsWith("super-");
}

async function main() {
  const rawDirStat = await stat(RAW_DIR).catch(() => null);
  if (!rawDirStat || !rawDirStat.isDirectory()) {
    console.error(
      `Missing ${RAW_DIR}. Run \`npm run sync:raw\` first to fetch raw HTML content.`,
    );
    process.exit(1);
  }

  const files = (await walk(RAW_DIR)).filter((p) => p.endsWith(".html"));
  const counts = new Map();
  const byClassFiles = new Map(); // class -> Set(file)

  const classAttrRe = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  for (const file of files) {
    const html = await readFile(file, "utf8");
    for (const m of html.matchAll(classAttrRe)) {
      const classValue = m[1] ?? m[2] ?? "";
      const tokens = pickClassTokens(classValue);
      for (const t of tokens) {
        if (!isNotionOrSuperClass(t)) continue;
        add(counts, t, 1);
        if (!byClassFiles.has(t)) byClassFiles.set(t, new Set());
        byClassFiles.get(t).add(path.relative(process.cwd(), file));
      }
    }
  }

  const uniqueClasses = Array.from(counts.keys()).sort((a, b) =>
    a.localeCompare(b),
  );
  const topClasses = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([name, count]) => ({ name, count }));

  const stamp = isoStampForPath();
  const outRunDir = path.join(OUT_DIR, stamp);
  await mkdir(outRunDir, { recursive: true });

  const json = {
    generatedAt: new Date().toISOString(),
    filesScanned: files.length,
    uniqueClassCount: uniqueClasses.length,
    uniqueClasses,
    topClasses,
    // Keep this small but actionable: which pages introduce which classes.
    filesByClass: Object.fromEntries(
      uniqueClasses.map((c) => [c, Array.from(byClassFiles.get(c) ?? [])]),
    ),
  };

  const mdLines = [
    "# Notion Block Audit",
    "",
    `Generated: ${json.generatedAt}`,
    `Files scanned: ${json.filesScanned}`,
    `Unique notion/super classes: ${json.uniqueClassCount}`,
    "",
    "## Top Classes",
    "",
    ...topClasses.map((x) => `- \`${x.name}\`: ${x.count}`),
    "",
    "## All Classes",
    "",
    ...uniqueClasses.map((c) => `- \`${c}\``),
    "",
  ];

  await writeFile(
    path.join(outRunDir, "notion-classes.json"),
    JSON.stringify(json, null, 2) + "\n",
    "utf8",
  );
  await writeFile(
    path.join(outRunDir, "notion-classes.md"),
    mdLines.join("\n"),
    "utf8",
  );

  // Stable outputs for CI-ish usage / quick diffing.
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    path.join(OUT_DIR, "latest.json"),
    JSON.stringify(json, null, 2) + "\n",
    "utf8",
  );
  await writeFile(path.join(OUT_DIR, "latest.md"), mdLines.join("\n"), "utf8");

  console.log(
    `Wrote ${path.relative(process.cwd(), outRunDir)}/notion-classes.{json,md}`,
  );
  console.log(
    `Wrote ${path.relative(process.cwd(), OUT_DIR)}/latest.{json,md}`,
  );
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

