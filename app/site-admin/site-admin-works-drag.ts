export function reorderWorksEntriesAcrossGroups<
  T extends { id: string; category: "recent" | "passed" },
>(items: T[], sourceId: string, targetId: string): T[] {
  if (!sourceId || !targetId || sourceId === targetId) return items;
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  const targetCategory = items[targetIndex]?.category;
  if (sourceIndex < 0 || targetIndex < 0 || !targetCategory) return items;

  const next = [...items];
  const [source] = next.splice(sourceIndex, 1);
  if (!source) return items;
  const adjustedTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  next.splice(adjustedTarget, 0, { ...source, category: targetCategory });
  return next;
}
