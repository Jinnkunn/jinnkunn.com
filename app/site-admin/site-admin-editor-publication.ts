import type { PublicationReview } from "../../lib/shared/publication-snapshot.ts";
import { parseCollectionDraft, type CollectionDraft } from "./site-admin-collection-draft.ts";
import { componentEntryFingerprint } from "./site-admin-structured-collection-model.ts";

type SavedChange = PublicationReview["changes"][number];

export type EditorPublicationAction =
  | { kind: "live"; href: string }
  | { kind: "review"; label: string; scope: string; detail?: string };

export function changedCollectionEntries(name: CollectionDraft["name"], change: SavedChange) {
  try {
    const rows = (source: string) => parseCollectionDraft(name, source).value.items.filter(
      (item) => !("type" in item && item.type === "divider"),
    );
    const before = rows(change.before);
    const after = rows(change.after);
    const liveById = new Map(before.map((item) => [item.id, componentEntryFingerprint(item)]));
    const savedIds = new Set(after.map((item) => item.id));
    if (liveById.size !== before.length || savedIds.size !== after.length) return null;

    // Compare the relative order of surviving entries, so an insert or
    // removal doesn't make every following entry look changed.
    const liveOrder = before.filter(({ id }) => savedIds.has(id)).map(({ id }) => id);
    const savedOrder = after.filter(({ id }) => liveById.has(id)).map(({ id }) => id);
    const movedIds = new Set(savedOrder.filter((id, index) => liveOrder[index] !== id));
    return new Map(after.map((item) => [
      item.id, movedIds.has(item.id) || liveById.get(item.id) !== componentEntryFingerprint(item),
    ]));
  } catch {
    return null;
  }
}

export function editorPublicationAction({
  path, href, change, scopes, entry, retryScope,
}: {
  path: string;
  href: string;
  change?: SavedChange;
  scopes: ReadonlySet<string>;
  entry?: { scope: string; changed: boolean | undefined };
  retryScope?: string;
}): EditorPublicationAction | null {
  const viewLive = href ? { kind: "live" as const, href } : null;
  if (!change) return viewLive;
  const documentScope = `document:${path}`;
  const collection = path.startsWith("components/");
  let action: Extract<EditorPublicationAction, { kind: "review" }>;

  if (entry && scopes.has(entry.scope)) {
    action = { kind: "review", label: "Review entry", scope: entry.scope };
  } else if (entry && entry.changed !== true) {
    return entry.changed === false ? viewLive : null;
  } else if (scopes.has(documentScope)) {
    action = {
      kind: "review", label: collection ? "Review collection" : "Review changes", scope: documentScope,
      detail: entry ? "This entry cannot be published separately." : undefined,
    };
  } else if (!entry && collection && [...scopes].some((scope) => scope.startsWith(`${path.slice(11, -4)}:`))) {
    action = { kind: "review", label: "Review changes", scope: "" };
  } else {
    action = {
      kind: "review", label: "Review all changes", scope: "all",
      detail: "This change cannot be published separately.",
    };
  }

  if (retryScope && (!entry || action.scope === retryScope) &&
    (retryScope === "all" || scopes.has(retryScope))) {
    return {
      kind: "review", scope: retryScope,
      label: retryScope === "all" ? "Review all changes again" : "Review and retry",
      detail: action.scope === retryScope ? action.detail : undefined,
    };
  }
  return action;
}
