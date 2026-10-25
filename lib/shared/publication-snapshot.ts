import * as implementation from "./publication-snapshot.mjs";
import type { SearchIndexItem } from "../search-index";
import type { RouteManifestItem } from "../routes-manifest";
import type { PublicationChangeDetails } from "./publication-review-details";
import type { ContentInventoryItem } from "./content-inventory";

export type PublicationSnapshot = { version: number; sha: string; sources: Record<string, string> };
export type PublicationSearchSnapshot = { version: number; snapshotSha: string; index: SearchIndexItem[]; manifest: RouteManifestItem[] };
export type PublicationReview = {
  snapshotSha: string; baselineSha: string;
  inventory?: ContentInventoryItem[];
  changes: { path: string; oldPath: string; kind: string; title: string; before: string; after: string; details?: PublicationChangeDetails }[];
};
// Typed facade keeps the publisher and request handlers on one snapshot algorithm.
export const PUBLICATION_BASELINE_PATH = implementation.PUBLICATION_BASELINE_PATH;
export const isPublicationSource = implementation.isPublicationSource;
export function publicationSnapshot(files: Record<string, string>): PublicationSnapshot {
  return implementation.publicationSnapshot(files) as PublicationSnapshot;
}
export function publicationReview(current: PublicationSnapshot, baseline: PublicationSnapshot): PublicationReview {
  return implementation.publicationReview(current, baseline) as PublicationReview;
}
export function readPublicationSearch(snapshot: { sha: string; search?: unknown } | null, fallback: {
  baseline: PublicationSnapshot; index: unknown[]; manifest: unknown[];
}): PublicationSearchSnapshot {
  return implementation.readPublicationSearch(snapshot, fallback) as PublicationSearchSnapshot;
}
