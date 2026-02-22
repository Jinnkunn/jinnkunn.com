import type { Metadata } from "next";
import Link from "next/link";

import { getHierarchicalSitemapRoutes, type SitemapRoute } from "@/lib/server/sitemap-routes";

import styles from "./sitemap.module.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Sitemap",
  description: "A hierarchical index of all public pages.",
};

type ChildrenMap = Map<string, SitemapRoute[]>;

function buildChildrenMap(items: SitemapRoute[]): ChildrenMap {
  const byParent: ChildrenMap = new Map();
  for (const item of items) {
    const parent = item.parentRoutePath || "";
    const arr = byParent.get(parent) || [];
    arr.push(item);
    byParent.set(parent, arr);
  }
  return byParent;
}

function renderTree(parentRoutePath: string, byParent: ChildrenMap): React.ReactNode {
  const children = byParent.get(parentRoutePath) || [];
  if (!children.length) return null;

  return (
    <ul className={styles.level}>
      {children.map((item) => {
        const hasChildren = (byParent.get(item.routePath) || []).length > 0;
        return (
          <li key={item.routePath} className={styles.item}>
            <Link href={item.routePath} className={styles.link}>
              <span className={styles.title}>{item.title}</span>
              <span className={styles.path}>{item.routePath}</span>
            </Link>
            {hasChildren ? renderTree(item.routePath, byParent) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function SitemapPage() {
  const items = getHierarchicalSitemapRoutes();
  const byParent = buildChildrenMap(items);

  return (
    <main id="page-sitemap" className="super-content page__sitemap parent-page__index">
      <div className="notion-header page">
        <div className="notion-header__cover no-cover no-icon" />
        <div className="notion-header__content max-width no-cover no-icon">
          <div className="notion-header__title-wrapper">
            <h1 className="notion-header__title">Sitemap</h1>
          </div>
        </div>
      </div>

      <article id="block-sitemap" className="notion-root max-width has-footer">
        <p className={`notion-text notion-text__content notion-semantic-string ${styles.lead}`}>
          Browse all public pages with parent-child structure.
        </p>
        <nav aria-label="Sitemap tree" className={styles.tree}>
          {renderTree("", byParent)}
        </nav>
      </article>
    </main>
  );
}
