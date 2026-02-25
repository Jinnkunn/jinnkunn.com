import type { ProtectedAccessMode } from "./access.ts";

export type ProtectedRoute = {
  id: string;
  auth?: ProtectedAccessMode;
  key?: "pageId" | "path";
  pageId?: string;
  path: string;
  mode: "exact" | "prefix";
  token: string;
};
