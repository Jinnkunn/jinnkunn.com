import { ContactsIcon } from "../../surfaces/icons";
import {
  CONTACTS_DEFAULT_NAV_ITEM_ID,
  CONTACTS_NAV_GROUPS,
} from "../../surfaces/contacts/nav";
import { ContactsSurface } from "../../surfaces/contacts/ContactsSurface";
import type { WorkspaceModuleDefinition } from "../types";

export const CONTACTS_MODULE: WorkspaceModuleDefinition = {
  id: "contacts",
  enabledByDefault: true,
  surface: {
    id: "contacts",
    title: "Contacts",
    description: "People",
    icon: <ContactsIcon />,
    Component: ContactsSurface,
    navGroups: CONTACTS_NAV_GROUPS,
    defaultNavItemId: CONTACTS_DEFAULT_NAV_ITEM_ID,
  },
  dashboardActions: [
    {
      id: "contacts:open",
      description: "People",
      label: "Contacts",
      navItemId: CONTACTS_DEFAULT_NAV_ITEM_ID,
      surfaceId: "contacts",
    },
  ],
  commandActions: [
    {
      id: "quick:contacts",
      hint: "People",
      keywords:
        "contacts crm people friends colleagues birthdays interactions",
      label: "Open Contacts",
      navItemId: CONTACTS_DEFAULT_NAV_ITEM_ID,
      surfaceId: "contacts",
    },
  ],
};
