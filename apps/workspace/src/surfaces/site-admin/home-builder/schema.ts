// HomeData schema helpers. The legacy section-based schema (hero /
// richText / linkList / featuredPages / layout) was retired when the
// Notion-mode editor became the only Home authoring surface — this
// file is now a thin layer over `{ title, bodyMdx }`.

import type { HomeData } from "../types";

const SCHEMA_VERSION = 4;

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function text(raw: unknown, fallback = ""): string {
  return typeof raw === "string" ? raw : fallback;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function sameData(a: HomeData, b: HomeData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function normalizeHomeData(raw: unknown): HomeData {
  const r = asRecord(raw) || {};
  const bodyMdx = typeof r.bodyMdx === "string" ? r.bodyMdx : undefined;
  return {
    schemaVersion: SCHEMA_VERSION,
    title: text(r.title).trim() || "Hi there!",
    bodyMdx: bodyMdx && bodyMdx.trim() ? bodyMdx : undefined,
  };
}

/** Coerces draft state into the exact shape we POST to
 * `/api/site-admin/home`. Drops blank / whitespace-only bodyMdx so an
 * empty editor doesn't pin the public render to an empty MDX body. */
export function prepareHomeDataForSave(data: HomeData): HomeData {
  return normalizeHomeData({
    title: data.title,
    bodyMdx: data.bodyMdx,
  });
}

export const BLANK_HOME_DATA = normalizeHomeData({});
