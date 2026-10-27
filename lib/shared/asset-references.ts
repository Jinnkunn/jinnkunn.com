export type AssetReference = {
  path: string;
  environment: "local" | "staging" | "production";
  state: "draft" | "published";
};

export type AssetReferenceSnapshot = Omit<AssetReference, "path"> & { sources: Record<string, string> };

function assetPath(value: string): string {
  try {
    const url = new URL(value.replace(/&amp;/g, "&"), "https://media.invalid/");
    return decodeURIComponent(url.pathname).replace(/^\/(?:public\/)?/, "");
  } catch { return ""; }
}

function sourceText(path: string, source: string): string {
  if (!path.endsWith(".json")) return source;
  // Decode escaped JSON URLs without executing any MDX or expressions.
  const strings: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(JSON.parse(source));
  return strings.join("\n");
}

export function findAssetReferences(
  assets: { key: string; url: string }[], snapshots: AssetReferenceSnapshot[],
): Record<string, AssetReference[]> {
  const byPath = new Map<string, string[]>();
  const result: Record<string, AssetReference[]> = {};
  for (const asset of assets) {
    result[asset.key] = [];
    for (const name of new Set([assetPath(asset.url), assetPath(asset.key)])) {
      if (name) byPath.set(name, [...(byPath.get(name) || []), asset.key]);
    }
  }
  for (const snapshot of snapshots) for (const [path, source] of Object.entries(snapshot.sources)) {
    const keys = new Set<string>();
    // Match literal URLs conservatively, including Markdown references, MDX
    // attributes and CSS url(). Code examples count as usage too.
    for (const match of sourceText(path, source).matchAll(/(?:https?:\/\/|(?:\/?public\/)?uploads\/)[^\s"'<>`{}\[\]()\\]+/g)) {
      const name = assetPath(match[0]);
      for (const key of byPath.get(name) || []) keys.add(key);
    }
    for (const key of keys) result[key].push({ path, environment: snapshot.environment, state: snapshot.state });
  }
  return result;
}
