export type PageTreeSource = {
  id: string;
  title: string;
};

export type PageTreeNode<T extends PageTreeSource> = {
  slug: string;
  segment: string;
  title: string;
  item: T | null;
  children: PageTreeNode<T>[];
};

export type PageBreadcrumbSegment = {
  slug: string;
  title: string;
};

function segmentTitle(segment: string): string {
  const words = segment
    .split("-")
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) return segment;
  return words
    .map((word) => (/^\d/.test(word) ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join(" ");
}

/**
 * Applies the persisted pre-order from content/page-tree.json, then appends
 * pages that have not been ordered yet. This mirrors the desktop admin while
 * keeping the web tree usable when the ordering endpoint is unavailable.
 */
export function orderPageTreeItems<T extends PageTreeSource>(
  items: T[],
  savedOrder: string[],
): T[] {
  const bySlug = new Map(
    items
      .filter((item) => item.id.trim())
      .map((item) => [item.id, item] as const),
  );
  const ordered: T[] = [];
  const seen = new Set<string>();

  for (const rawSlug of savedOrder) {
    const slug = rawSlug.trim();
    const item = bySlug.get(slug);
    if (!item || seen.has(slug)) continue;
    ordered.push(item);
    seen.add(slug);
  }

  const remaining = Array.from(bySlug.values())
    .filter((item) => !seen.has(item.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  return [...ordered, ...remaining];
}

/** Builds nested page nodes from slash-delimited slugs. */
export function buildPageTree<T extends PageTreeSource>(
  items: T[],
  savedOrder: string[] = [],
): PageTreeNode<T>[] {
  type MutableNode = PageTreeNode<T> & {
    childMap: Map<string, MutableNode>;
  };

  const root: MutableNode[] = [];
  const rootMap = new Map<string, MutableNode>();

  for (const item of orderPageTreeItems(items, savedOrder)) {
    const parts = item.id.split("/").map((part) => part.trim()).filter(Boolean);
    let level = root;
    let levelMap = rootMap;
    let slug = "";

    for (let index = 0; index < parts.length; index += 1) {
      const segment = parts[index];
      const isPage = index === parts.length - 1;
      slug = slug ? `${slug}/${segment}` : segment;
      let node = levelMap.get(segment);

      if (!node) {
        node = {
          slug,
          segment,
          title: isPage ? item.title || segmentTitle(segment) : segmentTitle(segment),
          item: isPage ? item : null,
          children: [],
          childMap: new Map(),
        };
        levelMap.set(segment, node);
        level.push(node);
      } else if (isPage) {
        node.item = item;
        node.title = item.title || node.title;
      }

      level = node.children as MutableNode[];
      levelMap = node.childMap;
    }
  }

  const stripMaps = (nodes: MutableNode[]): PageTreeNode<T>[] =>
    nodes.map((node) => ({
      slug: node.slug,
      segment: node.segment,
      title: node.title,
      item: node.item,
      children: stripMaps(node.children as MutableNode[]),
    }));

  return stripMaps(root);
}

/** Returns human titles for every ancestor represented by a page slug. */
export function pageBreadcrumb<T extends PageTreeSource>(
  slug: string,
  items: T[],
  currentTitle?: string,
): PageBreadcrumbSegment[] {
  const titleBySlug = new Map(items.map((item) => [item.id, item.title] as const));
  const parts = slug.split("/").map((part) => part.trim()).filter(Boolean);
  let path = "";
  return parts.map((segment, index) => {
    path = path ? `${path}/${segment}` : segment;
    return {
      slug: path,
      title:
        index === parts.length - 1 && currentTitle
          ? currentTitle
          : titleBySlug.get(path) || segmentTitle(segment),
    };
  });
}

export function pagePathLabel<T extends PageTreeSource>(slug: string, items: T[]): string {
  return pageBreadcrumb(slug, items)
    .map((segment) => segment.title)
    .join(" / ");
}
