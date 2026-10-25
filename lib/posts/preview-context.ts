import { AsyncLocalStorage } from "node:async_hooks";

const previewSources = new AsyncLocalStorage<Record<string, string>>();

export function withPreviewSources<T>(sources: Record<string, string>, render: () => T): T {
  return previewSources.run(sources, render);
}

export function isPagePreview() { return previewSources.getStore() !== undefined; }

export function previewComponentSource(name: string): string | undefined {
  const sources = previewSources.getStore();
  return sources ? sources[`components/${name}.mdx`] || "" : undefined;
}
