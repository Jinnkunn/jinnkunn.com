import { pathToFileURL } from "node:url";

import { resolveContentSourceKind } from "../lib/shared/content-source.mjs";
import { syncNotionContent } from "./sync-notion.mjs";
import { syncFilesystemContent } from "./content-sync/filesystem-source.mjs";

export async function syncContent() {
  const source = resolveContentSourceKind();
  if (source === "notion") {
    await syncNotionContent();
    return;
  }
  await syncFilesystemContent();
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  syncContent().catch((err) => {
    console.error(err?.stack || String(err));
    process.exitCode = 1;
  });
}
