import { invoke } from "@tauri-apps/api/core";
import {
  cachedResource,
  invalidateCachedResourcePrefix,
} from "../resourceCache";

/** One labelled contact method (email or phone). The server stores
 * an array of these per contact in JSON, so the wire shape is the
 * same for both `emails` and `phones`. */
export interface ContactMethod {
  value: string;
  label?: string | null;
  isPrimary?: boolean;
}

/** Personal CRM contact row. Mirrors `ContactRow` in
 * `src-tauri/src/contacts.rs` — keep the two in lockstep. */
export interface ContactRow {
  id: string;
  displayName: string;
  givenName: string | null;
  familyName: string | null;
  company: string | null;
  role: string | null;
  /** Birthday components are independently optional. Month + day are
   * always present together when set; year may be set independently
   * (some birthdays are known to the day but not the year). */
  birthdayMonth: number | null;
  birthdayDay: number | null;
  birthdayYear: number | null;
  emails: ContactMethod[];
  phones: ContactMethod[];
  tags: string[];
  notes: string;
  nextFollowUpAt: number | null;
  cadenceDays: number | null;
  pinnedAt: number | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** Most-recent interaction timestamp (unix ms) — derived at read
   * time. `null` when the contact has no logged interactions yet. */
  lastInteractionAt: number | null;
}

export interface ContactInteractionRow {
  id: string;
  contactId: string;
  occurredAt: number;
  /** Free-form discriminator. The surface uses a fixed set ("meeting",
   * "call", "message", "note", "other") but the store accepts any
   * non-empty string. */
  kind: string;
  note: string;
  /** Optional cross-reference, e.g. `calendar:eventId` for events
   * that auto-derived this row. Reserved for future automation. */
  source: string | null;
  createdAt: number;
}

export interface ContactSearchResult {
  id: string;
  displayName: string;
  company: string | null;
  excerpt: string;
  updatedAt: number;
}

export interface UpcomingBirthday {
  contactId: string;
  displayName: string;
  birthdayMonth: number;
  birthdayDay: number;
  birthdayYear: number | null;
  /** Days until the next occurrence — 0 = today, 1 = tomorrow, etc. */
  daysUntil: number;
  /** Age the contact will turn on the next occurrence, when the
   * birth year is known. */
  turningAge: number | null;
}

export interface ContactCreateParams {
  displayName?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  company?: string | null;
  role?: string | null;
  birthdayMonth?: number | null;
  birthdayDay?: number | null;
  birthdayYear?: number | null;
  emails?: ContactMethod[];
  phones?: ContactMethod[];
  tags?: string[];
  notes?: string | null;
  nextFollowUpAt?: number | null;
  cadenceDays?: number | null;
}

export interface ContactUpdateParams {
  id: string;
  displayName?: string;
  givenName?: string | null;
  familyName?: string | null;
  company?: string | null;
  role?: string | null;
  birthdayMonth?: number | null;
  birthdayDay?: number | null;
  birthdayYear?: number | null;
  emails?: ContactMethod[];
  phones?: ContactMethod[];
  tags?: string[];
  notes?: string;
  nextFollowUpAt?: number | null;
  cadenceDays?: number | null;
  pinned?: boolean;
}

export interface ContactInteractionCreateParams {
  contactId: string;
  occurredAt?: number | null;
  kind: string;
  note?: string | null;
  source?: string | null;
}

export interface ContactInteractionUpdateParams {
  id: string;
  occurredAt?: number;
  kind?: string;
  note?: string;
  source?: string | null;
}

export function contactsList(): Promise<ContactRow[]> {
  return cachedResource("contacts:list", () => invoke("contacts_list"));
}

export function contactsListArchived(): Promise<ContactRow[]> {
  return cachedResource("contacts:archived", () =>
    invoke("contacts_list_archived"),
  );
}

export function contactsGet(id: string): Promise<ContactRow | null> {
  return cachedResource(`contacts:detail:${id}`, () =>
    invoke("contacts_get", { id }),
  );
}

export function contactsCreate(
  params: ContactCreateParams,
): Promise<ContactRow> {
  invalidateCachedResourcePrefix("contacts:");
  return invoke("contacts_create", { params });
}

export function contactsUpdate(
  params: ContactUpdateParams,
): Promise<ContactRow> {
  invalidateCachedResourcePrefix("contacts:");
  return invoke("contacts_update", { params });
}

export function contactsArchive(id: string): Promise<void> {
  invalidateCachedResourcePrefix("contacts:");
  return invoke("contacts_archive", { id });
}

export function contactsUnarchive(id: string): Promise<ContactRow> {
  invalidateCachedResourcePrefix("contacts:");
  return invoke("contacts_unarchive", { id });
}

export function contactsSearch(query: string): Promise<ContactSearchResult[]> {
  const normalized = query.trim().toLowerCase();
  return cachedResource(`contacts:search:${normalized}`, () =>
    invoke("contacts_search", { params: { query } }),
  );
}

export function contactsUpcomingBirthdays(
  daysAhead?: number,
): Promise<UpcomingBirthday[]> {
  const normalized = daysAhead ?? "default";
  return cachedResource(`contacts:birthdays:${normalized}`, () =>
    invoke("contacts_upcoming_birthdays", {
      params: { daysAhead: daysAhead ?? null },
    }),
  );
}

export function contactInteractionsList(
  contactId: string,
): Promise<ContactInteractionRow[]> {
  return cachedResource(`contacts:interactions:${contactId}`, () =>
    invoke("contact_interactions_list", { contactId }),
  );
}

export function contactInteractionsCreate(
  params: ContactInteractionCreateParams,
): Promise<ContactInteractionRow> {
  invalidateCachedResourcePrefix("contacts:");
  return invoke("contact_interactions_create", { params });
}

export function contactInteractionsUpdate(
  params: ContactInteractionUpdateParams,
): Promise<ContactInteractionRow> {
  invalidateCachedResourcePrefix("contacts:");
  return invoke("contact_interactions_update", { params });
}

export function contactInteractionsDelete(id: string): Promise<void> {
  invalidateCachedResourcePrefix("contacts:");
  return invoke("contact_interactions_delete", { id });
}

/** Result of a single auto-derive sweep. `created` counts new
 * interactions inserted; `skipped` counts (event, contact) pairs that
 * were already logged via a prior sweep (dedupe key is
 * `calendar:<eventId>:<contactId>` on the interaction `source` field). */
export interface DeriveCalendarInteractionsResult {
  created: number;
  skipped: number;
  eventsScanned: number;
  contactsTouched: number;
}

/** Scan EventKit events in the supplied (or default) range and log
 * interactions for any attendee whose email matches a contact in the
 * personal CRM. The sweep is idempotent — re-running it is safe. */
export function contactsDeriveCalendarInteractions(
  range: { startsAt?: string; endsAt?: string } = {},
): Promise<DeriveCalendarInteractionsResult> {
  invalidateCachedResourcePrefix("contacts:");
  return invoke("contacts_derive_calendar_interactions", {
    params: {
      startsAt: range.startsAt ?? null,
      endsAt: range.endsAt ?? null,
    },
  });
}

/** One backlink row produced by the `@<contact name>` resolver. The
 * `mentionText` is the substring as it was written in the note body —
 * the surface uses it for highlighting and the offset for jumping. */
export interface ContactBacklink {
  noteId: string;
  noteTitle: string;
  noteIcon: string | null;
  mentionText: string;
  charOffset: number;
  mentionedAt: number;
  noteUpdatedAt: number;
}

/** List notes that mention this contact via `@<name>`. Driven by the
 * sync hook on `notes_update` — re-running the same note save updates
 * the backlink set without leaving stale rows. */
export function contactsListBacklinks(
  contactId: string,
): Promise<ContactBacklink[]> {
  return cachedResource(`contacts:backlinks:${contactId}`, () =>
    invoke("contacts_list_backlinks", { contactId }),
  );
}
