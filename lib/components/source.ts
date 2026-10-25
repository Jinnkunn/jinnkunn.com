import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getSiteComponentDefinition } from "@jinnkunn/content-core/components";
import type { SiteComponentName } from "@jinnkunn/content-core/components";
import { previewComponentSource } from "../posts/preview-context";

import {
  parseTeachingEntries,
  parseWorksEntries,
  type TeachingComponentEntry,
  type WorksComponentEntry,
} from "./parse";

export async function readComponentSource(name: SiteComponentName): Promise<string> {
  const preview = previewComponentSource(name);
  if (preview !== undefined) return preview;
  const sourcePath = resolve(
    process.cwd(),
    getSiteComponentDefinition(name).sourcePath,
  );
  try {
    return await readFile(sourcePath, "utf8");
  } catch {
    return "";
  }
}

export async function loadTeachingEntries(): Promise<TeachingComponentEntry[]> {
  return parseTeachingEntries(await readComponentSource("teaching"));
}

export async function loadWorksEntries(): Promise<WorksComponentEntry[]> {
  return parseWorksEntries(await readComponentSource("works"));
}
