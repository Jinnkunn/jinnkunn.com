import {
  parseNewsComponentDraft,
  parsePublicationsComponentDraft,
  parseTeachingComponentDraft,
  parseWorksComponentDraft,
  serializeNewsComponentDraft,
  serializePublicationsComponentDraft,
  serializeTeachingComponentDraft,
  serializeWorksComponentDraft,
  type NewsComponentDraft,
  type PublicationsComponentDraft,
  type TeachingComponentDraft,
  type WorksComponentDraft,
} from "./site-admin-structured-collection-model.ts";

export type CollectionDraft =
  | { name: "news"; value: NewsComponentDraft }
  | { name: "teaching"; value: TeachingComponentDraft }
  | { name: "works"; value: WorksComponentDraft }
  | { name: "publications"; value: PublicationsComponentDraft };

export type CollectionHistory = {
  present: CollectionDraft;
  past: CollectionDraft[];
  future: CollectionDraft[];
  group: string;
};

export function parseCollectionDraft(name: CollectionDraft["name"], source: string): CollectionDraft {
  switch (name) {
    case "news": return { name, value: parseNewsComponentDraft(source) };
    case "teaching": return { name, value: parseTeachingComponentDraft(source) };
    case "works": return { name, value: parseWorksComponentDraft(source) };
    case "publications": return { name, value: parsePublicationsComponentDraft(source) };
  }
}

export function serializeCollectionDraft(draft: CollectionDraft): string {
  switch (draft.name) {
    case "news": return serializeNewsComponentDraft(draft.value);
    case "teaching": return serializeTeachingComponentDraft(draft.value);
    case "works": return serializeWorksComponentDraft(draft.value);
    case "publications": return serializePublicationsComponentDraft(draft.value);
  }
}

export function collectionHistory(present: CollectionDraft): CollectionHistory {
  return { present, past: [], future: [], group: "" };
}

export function commitCollectionDraft(
  history: CollectionHistory,
  present: CollectionDraft,
  group = "",
): CollectionHistory {
  if (JSON.stringify(history.present) === JSON.stringify(present)) return history;
  return {
    present,
    past: group && group === history.group
      ? history.past
      : [...history.past, history.present].slice(-50),
    future: [],
    group,
  };
}

export function undoCollectionDraft(history: CollectionHistory): CollectionHistory {
  const present = history.past.at(-1);
  if (!present) return history;
  return { present, past: history.past.slice(0, -1), future: [history.present, ...history.future], group: "" };
}

export function redoCollectionDraft(history: CollectionHistory): CollectionHistory {
  const present = history.future[0];
  if (!present) return history;
  return { present, past: [...history.past, history.present], future: history.future.slice(1), group: "" };
}

export function groupCollectionItems<T>(items: T[], groupFor: (item: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groupFor(item);
    const entries = groups.get(group) || [];
    entries.push(item);
    groups.set(group, entries);
  }
  return [...groups.values()].flat();
}

export function collectionPlainText(body: string): string {
  return body
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
