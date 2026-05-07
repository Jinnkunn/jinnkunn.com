import type { MdxBlock, MdxBlockType } from "./mdx-blocks";

export function findBlockInTree(blocks: MdxBlock[], id: string): MdxBlock | null {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.children) {
      const child = findBlockInTree(block.children, id);
      if (child) return child;
    }
  }
  return null;
}

export function patchBlockInTree(
  blocks: MdxBlock[],
  id: string,
  patcher: (block: MdxBlock) => MdxBlock,
): { changed: boolean; blocks: MdxBlock[] } {
  let changed = false;
  const next = blocks.map((block) => {
    if (block.id === id) {
      changed = true;
      return patcher(block);
    }
    if (!block.children) return block;
    const childResult = patchBlockInTree(block.children, id, patcher);
    if (!childResult.changed) return block;
    changed = true;
    return { ...block, children: childResult.blocks };
  });
  return { changed, blocks: next };
}

export function countBlocksOfType(blocks: MdxBlock[], type: MdxBlockType): number {
  let count = 0;
  for (const block of blocks) {
    if (block.type === type) count += 1;
    if (block.children) count += countBlocksOfType(block.children, type);
  }
  return count;
}

/**
 * Reorder a block within its sibling list. Pure helper used by the
 * block-editor drag-and-drop path so the splice indices stay correct
 * when the source is moved past the target.
 *
 * Returns the original array (referentially equal) for no-op moves so
 * callers can short-circuit the commit/serialize work.
 */
export function reorderSiblings<T extends { id: string }>(
  siblings: readonly T[],
  draggedId: string,
  targetId: string,
  position: "above" | "below",
): T[] {
  if (!draggedId || draggedId === targetId) return siblings as T[];
  const from = siblings.findIndex((b) => b.id === draggedId);
  const to = siblings.findIndex((b) => b.id === targetId);
  if (from < 0 || to < 0) return siblings as T[];
  let insertAt = position === "below" ? to + 1 : to;
  // After splicing the source out, every index past `from` shifts down
  // by one. Adjust the destination so the block lands exactly where the
  // user pointed — without this, dragging downward always overshoots by
  // one slot, which is what users were running into in the news editor.
  if (from < insertAt) insertAt -= 1;
  if (from === insertAt) return siblings as T[];
  const next = siblings.slice();
  const [moved] = next.splice(from, 1);
  next.splice(insertAt, 0, moved);
  return next;
}
