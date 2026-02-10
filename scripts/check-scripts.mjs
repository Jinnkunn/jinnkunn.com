import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function walk(dirAbs, out) {
  let ents = [];
  try {
    ents = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of ents) {
    const abs = path.join(dirAbs, ent.name);
    if (ent.isDirectory()) {
      // Avoid scanning deps/build output.
      if (ent.name === "node_modules" || ent.name === ".next" || ent.name === ".git") continue;
      walk(abs, out);
      continue;
    }
    if (ent.isFile() && abs.endsWith(".mjs")) out.push(abs);
  }
}

function rel(p) {
  return path.relative(process.cwd(), p).replace(/\\/g, "/");
}

function main() {
  const roots = [
    path.join(process.cwd(), "scripts"),
    path.join(process.cwd(), "lib"),
  ];

  const files = [];
  for (const r of roots) walk(r, files);
  files.sort((a, b) => a.localeCompare(b));

  const failed = [];
  for (const f of files) {
    const res = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
    if (res.status === 0) continue;
    failed.push({
      file: rel(f),
      stderr: String(res.stderr || "").trim(),
    });
  }

  if (failed.length) {
    console.error("JS syntax check failed for .mjs files:");
    for (const it of failed) {
      console.error(`\n- ${it.file}`);
      if (it.stderr) console.error(it.stderr);
    }
    process.exit(1);
  }

  console.log(`Checked ${files.length} .mjs files (OK).`);
}

main();

