import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Cake,
  History,
  Home,
  Pin,
  UserRoundCheck,
  Users,
} from "lucide-react";

import type { SurfaceNavGroup, SurfaceNavItem } from "../types";

export const CONTACTS_HOME_NAV_ID = "contacts:home";
export const CONTACTS_FOLLOW_UP_NAV_ID = "contacts:follow-up";
export const CONTACTS_ALL_NAV_ID = "contacts:all";
export const CONTACTS_PINNED_NAV_ID = "contacts:pinned";
export const CONTACTS_RECENT_NAV_ID = "contacts:recent";
export const CONTACTS_BIRTHDAYS_NAV_ID = "contacts:birthdays";
export const CONTACTS_ARCHIVED_NAV_ID = "contacts:archived";
export const CONTACTS_DEFAULT_NAV_ITEM_ID = CONTACTS_HOME_NAV_ID;
const CONTACTS_FOCUS_GROUP_ID = "contacts:focus";

export type ContactsNavItemId =
  | typeof CONTACTS_HOME_NAV_ID
  | typeof CONTACTS_FOLLOW_UP_NAV_ID
  | typeof CONTACTS_ALL_NAV_ID
  | typeof CONTACTS_PINNED_NAV_ID
  | typeof CONTACTS_RECENT_NAV_ID
  | typeof CONTACTS_BIRTHDAYS_NAV_ID
  | typeof CONTACTS_ARCHIVED_NAV_ID;

export type ContactsNavCounts = Partial<Record<ContactsNavItemId, number>>;

function navIcon(Icon: LucideIcon) {
  return (
    <Icon
      absoluteStrokeWidth
      aria-hidden="true"
      focusable="false"
      size={14}
      strokeWidth={1.6}
    />
  );
}

function badgeFromCount(
  counts: ContactsNavCounts,
  id: ContactsNavItemId,
): SurfaceNavItem["badge"] {
  const count = counts[id];
  return count ? String(count) : undefined;
}

function navItem(
  counts: ContactsNavCounts,
  id: ContactsNavItemId,
  label: string,
  Icon: LucideIcon,
): SurfaceNavItem {
  return {
    id,
    label,
    badge: badgeFromCount(counts, id),
    icon: navIcon(Icon),
  };
}

export function createContactsNavGroups(
  counts: ContactsNavCounts = {},
): readonly SurfaceNavGroup[] {
  return [
    {
      id: CONTACTS_FOCUS_GROUP_ID,
      label: "CRM",
      items: [
        navItem(counts, CONTACTS_HOME_NAV_ID, "Home", Home),
        navItem(counts, CONTACTS_FOLLOW_UP_NAV_ID, "Follow up", UserRoundCheck),
        navItem(counts, CONTACTS_ALL_NAV_ID, "All", Users),
        navItem(counts, CONTACTS_PINNED_NAV_ID, "Pinned", Pin),
        navItem(counts, CONTACTS_RECENT_NAV_ID, "Recent", History),
        navItem(counts, CONTACTS_BIRTHDAYS_NAV_ID, "Birthdays", Cake),
        navItem(counts, CONTACTS_ARCHIVED_NAV_ID, "Archived", Archive),
      ],
    },
  ];
}

export const CONTACTS_NAV_GROUPS: readonly SurfaceNavGroup[] =
  createContactsNavGroups();
