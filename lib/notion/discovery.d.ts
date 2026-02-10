export function findChildDatabases(blockId: string, maxDepth?: number): Promise<Array<{ id: string; title: string }>>;
export function findDbByTitle(dbs: Array<{ id: string; title: string }>, title: string): { id: string; title: string } | null;

