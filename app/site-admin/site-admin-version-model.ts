import { describePublicationChange } from "../../lib/shared/publication-review-details.ts";
import type { PublicationReview, PublicationSnapshot } from "../../lib/shared/publication-snapshot.ts";

export function describeVersionRestore(path: string, current: string, earlier: string): PublicationReview["changes"] {
  if (current === earlier) return [];
  const relative = path.replace(/^content\//, "");
  const snapshot = (source: string): PublicationSnapshot => ({ version: 1, sha: "", sources: { [relative]: source } });
  const change: PublicationReview["changes"][number] = {
    path: relative, oldPath: relative, kind: "restore", title: "Restore impact", before: current, after: earlier,
  };
  change.details = describePublicationChange(change, snapshot(earlier), snapshot(current));
  return [change];
}
