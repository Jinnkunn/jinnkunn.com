import type { RouteManifestItem } from "../routes-manifest";

export type RouteTreeItem = RouteManifestItem & {
  depth: number;
  hasChildren: boolean;
};

export type RouteTree = {
  ordered: RouteTreeItem[];
  parentById: Map<string, string>; // id -> effective parent id ("" = root)
  childrenById: Map<string, string[]>; // id -> child ids
};

export type AdminProtectedRule = {
  auth: "password" | "github";
  mode: "exact" | "prefix";
  path: string;
};

export type AdminConfig = {
  overrides: Record<string, string>; // pageId -> routePath
  protectedByPageId: Record<string, AdminProtectedRule>; // pageId -> protection rule
};

export type EffectiveAccess = {
  auth: "password" | "github";
  direct: boolean;
  inherited: boolean;
  sourceId: string; // 32-hex if known
  sourcePath: string;
};
