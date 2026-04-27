// Components are a small fixed set of reusable MDX widgets the admin
// edits separately from page content. Each lives at
// `content/components/{name}.mdx` and is embedded into pages via the
// matching `<{Name}Block />` shortcode (see components/posts-mdx/*).
//
// This module is the read/write counterpart to lib/pages/store —
// scaled down because components don't have URLs (no slug rules, no
// drafts, no listing endpoint), aren't created or deleted at runtime
// (the four names are fixed by code), and never move.

import {
  ContentStoreConflictError,
  ContentStoreNotFoundError,
  type ContentStore,
  type ContentVersion,
} from "@/lib/server/content-store";
import { getContentStore } from "@/lib/server/content-store-resolver";
import {
  SITE_COMPONENT_DEFINITIONS,
  SITE_COMPONENT_NAMES,
  getSiteComponentDefinition,
  isSiteComponentName,
  type SiteComponentName,
} from "@/lib/site-admin/component-registry";

/** Fixed list of editable components — kept in sync with the
 * `<{Name}Block />` server components in `components/posts-mdx/*`
 * and the admin Components panel leaves. Adding a new entry here
 * requires the matching block, MDX file, and panel wiring. */
export const COMPONENT_NAMES = SITE_COMPONENT_NAMES;

export type ComponentName = SiteComponentName;

export function isValidComponentName(value: unknown): value is ComponentName {
  return isSiteComponentName(value);
}

function componentRelPath(name: ComponentName): string {
  return getSiteComponentDefinition(name).contentRelPath;
}

export type ComponentDetail = {
  name: ComponentName;
  source: string;
  version: ContentVersion;
};

async function getStore(): Promise<ContentStore> {
  return getContentStore();
}

export { ContentStoreConflictError, ContentStoreNotFoundError };

export async function readComponent(
  name: ComponentName,
): Promise<ComponentDetail | null> {
  const store = await getStore();
  const file = await store.readFile(componentRelPath(name));
  if (!file) return null;
  return { name, source: file.content, version: file.sha };
}

export async function updateComponent(
  name: ComponentName,
  source: string,
  ifMatch: ContentVersion,
): Promise<ComponentDetail> {
  const store = await getStore();
  const { sha } = await store.writeFile(componentRelPath(name), source, {
    ifMatch,
  });
  return { name, source, version: sha };
}

export { SITE_COMPONENT_DEFINITIONS };
