import { SiteAdminIcon } from "../../surfaces/icons";
import {
  SITE_ADMIN_DEFAULT_TAB,
  SITE_ADMIN_NAV_GROUPS,
} from "../../surfaces/site-admin/nav";
import { SiteAdminSurface } from "../../surfaces/site-admin/SiteAdminSurface";
import type { WorkspaceModuleDefinition } from "../types";

export const SITE_ADMIN_MODULE: WorkspaceModuleDefinition = {
  id: "site-admin",
  enabledByDefault: true,
  surface: {
    id: "site-admin",
    title: "Site Admin",
    description: "Publish",
    icon: <SiteAdminIcon />,
    Component: SiteAdminSurface,
    navGroups: SITE_ADMIN_NAV_GROUPS,
    defaultNavItemId: SITE_ADMIN_DEFAULT_TAB,
  },
  dashboardActions: [
    {
      id: "site-admin:status",
      description: "Status",
      label: "Status",
      navItemId: "status",
      surfaceId: "site-admin",
    },
    {
      id: "site-admin:home",
      description: "Home",
      label: "Home",
      navItemId: "home",
      surfaceId: "site-admin",
    },
    {
      id: "site-admin:components",
      description: "Shared",
      label: "Shared",
      navItemId: "components",
      surfaceId: "site-admin",
    },
  ],
  commandActions: [
    {
      id: "quick:site-status",
      hint: "Deploy health",
      keywords: "deploy status staging production worker candidate publish",
      label: "Open Site Status",
      navItemId: "status",
      surfaceId: "site-admin",
    },
    {
      id: "quick:home-editor",
      hint: "Landing page",
      keywords: "home landing editor mdx page",
      label: "Open Home Editor",
      navItemId: "home",
      surfaceId: "site-admin",
    },
    {
      id: "quick:shared-content",
      hint: "Reusable blocks",
      keywords: "shared components news teaching publications works",
      label: "Open Shared Content",
      navItemId: "components",
      surfaceId: "site-admin",
    },
    {
      id: "quick:site-links",
      hint: "Route and icon checks",
      keywords: "links audit icon link internal route broken protected",
      label: "Open Link Audit",
      navItemId: "links",
      surfaceId: "site-admin",
    },
  ],
};
