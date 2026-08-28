import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getSiteComponentDefinition } from "@/lib/site-admin/component-registry";

import {
  parseTeachingEntries,
  parseWorksEntries,
  type TeachingComponentEntry,
  type WorksComponentEntry,
} from "./parse";

async function readComponentSource(name: "teaching" | "works"): Promise<string> {
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
