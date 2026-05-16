import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../../", import.meta.url);

async function read(relPath) {
  return readFile(new URL(relPath, ROOT), "utf8");
}

function extractRegisteredCommands(libRs) {
  const match = libRs.match(/tauri::generate_handler!\[([\s\S]*?)\]\)/);
  assert.ok(match, "generate_handler block should exist");
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("#["))
    .map((line) => line.replace(/,$/, ""))
    .filter(Boolean)
    .map((path) => {
      const parts = path.split("::");
      return {
        group: parts[0],
        name: parts.at(-1),
      };
    });
}

test("Tauri command manifest matches Rust invoke handler", async () => {
  const [libRs, manifestRaw] = await Promise.all([
    read("apps/workspace/src-tauri/src/lib.rs"),
    read("apps/workspace/src-tauri/commands.manifest.json"),
  ]);
  const registered = extractRegisteredCommands(libRs);
  const manifest = JSON.parse(manifestRaw);
  const groupNames = Object.keys(manifest.groups);
  const manifestCommands = Object.entries(manifest.groups).flatMap(
    ([group, commands]) => commands.map((name) => ({ group, name })),
  );

  assert.equal(manifest.commandCount, registered.length);
  assert.deepEqual(groupNames, [...groupNames].sort(), "manifest groups stay sorted");
  assert.deepEqual(
    Object.keys(manifest.groupMetadata),
    groupNames,
    "each command group has ownership metadata",
  );
  for (const [group, commands] of Object.entries(manifest.groups)) {
    assert.deepEqual(commands, [...commands].sort(), `${group} commands stay sorted`);
    assert.match(
      manifest.groupMetadata[group]?.rustModule ?? "",
      /^apps\/workspace\/src-tauri\/src\//,
      `${group} metadata points at a Rust module`,
    );
    assert.ok(
      manifest.groupMetadata[group]?.tsApi,
      `${group} metadata points at a TS API owner`,
    );
  }
  assert.deepEqual(
    manifestCommands
      .map((command) => `${command.group}:${command.name}`)
      .sort(),
    registered
      .map((command) => `${command.group}:${command.name}`)
      .sort(),
  );
});
