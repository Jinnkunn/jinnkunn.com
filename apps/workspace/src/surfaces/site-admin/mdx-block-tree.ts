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
