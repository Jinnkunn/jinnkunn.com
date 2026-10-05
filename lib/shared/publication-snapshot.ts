import * as implementation from "./publication-snapshot.mjs";

export type PublicationSnapshot = { version: number; sha: string; sources: Record<string, string> };
export type PublicationReview = {
  snapshotSha: string; baselineSha: string;
  changes: { path: string; oldPath: string; kind: string; title: string; before: string; after: string }[];
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
