import {
  SITE_COMPONENT_DEFINITIONS,
  type SiteComponentDefinition,
  type SiteComponentName,
} from "../site-admin/component-registry.ts";

export type ComponentUsageSourceKind = "home" | "page" | "post";

export type ComponentUsageSource = {
  kind: ComponentUsageSourceKind;
  sourcePath: string;
  routePath: string;
  title: string;
  source: string;
};

export type ComponentUsage = {
  kind: ComponentUsageSourceKind;
  sourcePath: string;
  routePath: string;
  title: string;
  embedTag: string;
};

export type ComponentUsageMap = Record<SiteComponentName, ComponentUsage[]>;

function emptyUsageMap(): ComponentUsageMap {
  const out = {} as ComponentUsageMap;
  for (const definition of SITE_COMPONENT_DEFINITIONS) {
    out[definition.name] = [];
  }
  return out;
}

function containsEmbed(source: string, definition: SiteComponentDefinition): boolean {
  const pattern = new RegExp(`<${definition.embedTag}\\b`);
  return pattern.test(source);
}

export function findComponentUsagesInSources(
  sources: ComponentUsageSource[],
): ComponentUsageMap {
  const out = emptyUsageMap();
  for (const source of sources) {
    for (const definition of SITE_COMPONENT_DEFINITIONS) {
      if (!containsEmbed(source.source, definition)) continue;
      out[definition.name].push({
        kind: source.kind,
        sourcePath: source.sourcePath,
        routePath: source.routePath,
        title: source.title,
        embedTag: definition.embedTag,
      });
    }
  }
  for (const usages of Object.values(out)) {
    usages.sort((a, b) => {
      const byKind = a.kind.localeCompare(b.kind);
      if (byKind !== 0) return byKind;
      return a.routePath.localeCompare(b.routePath);
    });
  }
  return out;
}
