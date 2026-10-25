export type ContentTaskFilter = "all" | "pending" | "hidden" | "issues" | "recent" | "pinned";
export const CONTENT_TASK_FILTERS: { value: ContentTaskFilter; label: string }[] = [
  { value: "all", label: "All content" }, { value: "pending", label: "Pending publication" },
  { value: "hidden", label: "Hidden" }, { value: "issues", label: "Needs attention" },
  { value: "recent", label: "Recently modified" }, { value: "pinned", label: "Pinned" },
];
export function contentMatchesTask(item: { pending?: boolean; draft?: boolean; issueCount: number; modifiedAt?: string | null; pinned?: boolean }, filter: ContentTaskFilter, now = Date.now()) {
  if (filter === "pending") return item.pending === true;
  if (filter === "hidden") return item.draft === true;
  if (filter === "issues") return item.issueCount > 0;
  if (filter === "pinned") return item.pinned === true;
  if (filter === "recent") {
    const date = Date.parse(item.modifiedAt || "");
    return date <= now && date >= now - 30 * 24 * 60 * 60 * 1000;
  }
  return true;
}
export function readContentPins(raw: string | null): string[] {
  try {
    const data = JSON.parse(raw || "null");
    if (data?.version !== 1 || !Array.isArray(data.items)) return [];
    return [...new Set<string>(data.items.filter((key: unknown) => typeof key === "string" && /^(posts|pages|components):[a-z0-9][a-z0-9/-]{0,240}$/.test(key)))].slice(0, 40);
  } catch { return []; }
}
