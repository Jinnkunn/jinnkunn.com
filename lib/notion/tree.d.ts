export function listBlockChildrenCached(blockId: string): Promise<any[]>;
export function getDatabaseParentPageId(databaseId: string): Promise<string>;
export function getDatabaseInfo(databaseId: string): Promise<{ id: string; title: string; lastEdited: string }>;
export function hydrateBlocks(blocks: any[]): Promise<any[]>;
export function findFirstJsonCodeBlock(blockId: string, maxDepth?: number): Promise<{ blockId: string; json: string } | null>;
export function findChildDatabases(blockId: string, maxDepth?: number): Promise<Array<{ id: string; title: string }>>;

