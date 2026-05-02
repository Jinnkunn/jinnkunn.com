import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Cake,
  History,
  Pin,
  PinOff,
  Plus,
  StickyNote,
  Trash2,
  UserRoundCheck,
} from "lucide-react";

import { useSurfaceNav } from "../../shell/surface-nav-context";
import { noteNavId } from "../notes/tree";
import {
  WorkspaceCommandBar,
  WorkspaceCommandButton,
  WorkspaceCommandGroup,
  WorkspaceEmptyState,
  WorkspaceInlineStatus,
  WorkspaceSurfaceFrame,
} from "../../ui/primitives";
import {
  contactInteractionsCreate,
  contactInteractionsDelete,
  contactInteractionsList,
  contactsArchive,
  contactsCreate,
  contactsDeriveCalendarInteractions,
  contactsGet,
  contactsList,
  contactsListArchived,
  contactsListBacklinks,
  contactsSearch,
  contactsUnarchive,
  contactsUpcomingBirthdays,
  contactsUpdate,
  type ContactBacklink,
  type ContactInteractionRow,
  type ContactMethod,
  type ContactRow,
  type UpcomingBirthday,
} from "../../modules/contacts/api";
import {
  CONTACTS_ALL_NAV_ID,
  CONTACTS_ARCHIVED_NAV_ID,
  CONTACTS_BIRTHDAYS_NAV_ID,
  CONTACTS_DEFAULT_NAV_ITEM_ID,
  CONTACTS_FOLLOW_UP_NAV_ID,
  CONTACTS_HOME_NAV_ID,
  CONTACTS_PINNED_NAV_ID,
  CONTACTS_RECENT_NAV_ID,
  type ContactsNavCounts,
  createContactsNavGroups,
} from "./nav";
import "../../styles/surfaces/contacts.css";

const CONTACTS_NAV_IDS: ReadonlyArray<string> = [
  CONTACTS_HOME_NAV_ID,
  CONTACTS_FOLLOW_UP_NAV_ID,
  CONTACTS_ALL_NAV_ID,
  CONTACTS_PINNED_NAV_ID,
  CONTACTS_RECENT_NAV_ID,
  CONTACTS_BIRTHDAYS_NAV_ID,
  CONTACTS_ARCHIVED_NAV_ID,
];

const INTERACTION_KINDS = [
  "meeting",
  "call",
  "message",
  "note",
  "other",
] as const;

const DAY_MS = 86_400_000;
const SEARCH_DEBOUNCE_MS = 160;

type InteractionKind = (typeof INTERACTION_KINDS)[number];
type ContactsFilter =
  | "home"
  | "followup"
  | "all"
  | "pinned"
  | "recent"
  | "birthdays"
  | "archived";
type NoticeKind = "info" | "error";

interface ContactsNotice {
  text: string;
  kind: NoticeKind;
}

function filterFromNavItem(id: string | null): ContactsFilter {
  if (id === CONTACTS_FOLLOW_UP_NAV_ID) return "followup";
  if (id === CONTACTS_ALL_NAV_ID) return "all";
  if (id === CONTACTS_PINNED_NAV_ID) return "pinned";
  if (id === CONTACTS_RECENT_NAV_ID) return "recent";
  if (id === CONTACTS_BIRTHDAYS_NAV_ID) return "birthdays";
  if (id === CONTACTS_ARCHIVED_NAV_ID) return "archived";
  return "home";
}

function endOfToday(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function isFollowUpDue(contact: ContactRow, timestamp: number): boolean {
  return (
    contact.archivedAt === null &&
    contact.nextFollowUpAt !== null &&
    contact.nextFollowUpAt <= endOfToday(timestamp)
  );
}

function filterContact(contact: ContactRow, filter: ContactsFilter): boolean {
  if (contact.archivedAt !== null) return false;
  if (filter === "pinned") return contact.pinnedAt !== null;
  if (filter === "recent") return contact.lastInteractionAt !== null;
  if (filter === "followup") return contact.nextFollowUpAt !== null;
  return true;
}

function localSearchContacts(
  rows: readonly ContactRow[],
  query: string,
): ContactRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((contact) => {
    if (contact.displayName.toLowerCase().includes(needle)) return true;
    if (contact.company?.toLowerCase().includes(needle)) return true;
    if (contact.role?.toLowerCase().includes(needle)) return true;
    if (contact.emails.some((m) => m.value.toLowerCase().includes(needle))) {
      return true;
    }
    if (contact.phones.some((m) => m.value.toLowerCase().includes(needle))) {
      return true;
    }
    if (contact.tags.some((t) => t.toLowerCase().includes(needle))) return true;
    if (contact.notes.toLowerCase().includes(needle)) return true;
    return false;
  });
}

function formatShortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatLastInteraction(timestamp: number | null): string {
  if (!timestamp) return "No touch yet";
  return `Last ${formatShortDate(timestamp)}`;
}

function formatFollowUp(timestamp: number | null, now: number): string {
  if (!timestamp) return "No follow-up";
  const todayEnd = endOfToday(now);
  const tomorrowEnd = todayEnd + DAY_MS;
  if (timestamp < now) return `Overdue ${formatShortDate(timestamp)}`;
  if (timestamp <= todayEnd) return "Today";
  if (timestamp <= tomorrowEnd) return "Tomorrow";
  return formatShortDate(timestamp);
}

function formatBirthday(
  month: number | null,
  day: number | null,
  year: number | null,
): string | null {
  if (month === null || day === null) return null;
  const probe = new Date(2000, month - 1, day);
  const monthDay = probe.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  return year ? `${monthDay} ${year}` : monthDay;
}

function formatBirthdayCountdown(b: UpcomingBirthday): string {
  if (b.daysUntil === 0) return "Today";
  if (b.daysUntil === 1) return "Tomorrow";
  return `${b.daysUntil}d`;
}

function isNativeBridgeUnavailable(error: unknown): boolean {
  const message = String(error);
  return (
    message.includes("invoke") ||
    message.includes("__TAURI_INTERNALS__") ||
    message.includes("is not a function")
  );
}

function formatContactsError(error: unknown): string {
  if (isNativeBridgeUnavailable(error)) {
    return "Contacts unavailable in this preview.";
  }
  return String(error);
}

function sortContacts(rows: readonly ContactRow[]): ContactRow[] {
  return [...rows].sort((a, b) => {
    const aPinned = a.pinnedAt ?? 0;
    const bPinned = b.pinnedAt ?? 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return a.displayName.localeCompare(b.displayName);
  });
}

function sortContactsByRecency(rows: readonly ContactRow[]): ContactRow[] {
  return [...rows].sort(
    (a, b) => (b.lastInteractionAt ?? 0) - (a.lastInteractionAt ?? 0),
  );
}

function sortContactsByFollowUp(rows: readonly ContactRow[]): ContactRow[] {
  return [...rows].sort(
    (a, b) => (a.nextFollowUpAt ?? Number.MAX_SAFE_INTEGER) -
      (b.nextFollowUpAt ?? Number.MAX_SAFE_INTEGER),
  );
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  const head = parts[0] ?? "";
  const tail = parts[parts.length - 1] ?? "";
  return ((head[0] ?? "") + (parts.length > 1 ? tail[0] ?? "" : ""))
    .toUpperCase();
}

function primaryMethod(methods: ContactMethod[]): ContactMethod | null {
  if (methods.length === 0) return null;
  return methods.find((m) => m.isPrimary) ?? methods[0];
}

function dateInputValue(timestamp: number | null): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timestampFromDateInput(value: string): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, 9, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function iconProps(size = 14) {
  return {
    absoluteStrokeWidth: true,
    "aria-hidden": true,
    focusable: false,
    size,
    strokeWidth: 1.7,
  } as const;
}

export function ContactsSurface() {
  const {
    activeNavItemId,
    selectWorkspaceNavItem,
    setActiveNavItemId,
    setNavGroupItems,
  } = useSurfaceNav();
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [archivedContacts, setArchivedContacts] = useState<ContactRow[]>([]);
  const [nowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<ContactsNotice | null>(null);
  const [undoContact, setUndoContact] = useState<ContactRow | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResultIds, setSearchResultIds] = useState<string[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [interactions, setInteractions] = useState<ContactInteractionRow[]>([]);
  const [backlinks, setBacklinks] = useState<ContactBacklink[]>([]);
  const [birthdays, setBirthdays] = useState<UpcomingBirthday[]>([]);
  const [showNewContactDialog, setShowNewContactDialog] = useState(false);
  const [syncingCalendar, setSyncingCalendar] = useState(false);

  useEffect(() => {
    if (!activeNavItemId || !CONTACTS_NAV_IDS.includes(activeNavItemId)) {
      setActiveNavItemId(CONTACTS_DEFAULT_NAV_ITEM_ID);
    }
  }, [activeNavItemId, setActiveNavItemId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      contactsList(),
      contactsListArchived(),
      contactsUpcomingBirthdays(60),
    ])
      .then(([activeRows, archivedRows, birthdayRows]) => {
        if (cancelled) return;
        setContacts(sortContacts(activeRows));
        setArchivedContacts(archivedRows);
        setBirthdays(birthdayRows);
      })
      .catch((error) => {
        if (!cancelled && !isNativeBridgeUnavailable(error)) {
          setNotice({
            kind: "error",
            text: `Failed to load contacts: ${formatContactsError(error)}`,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResultIds(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      contactsSearch(query)
        .then((rows) => {
          if (!cancelled) setSearchResultIds(rows.map((row) => row.id));
        })
        .catch(() => {
          if (!cancelled) setSearchResultIds(null);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  const filter = filterFromNavItem(activeNavItemId);
  const isSearching = searchQuery.trim().length > 0;
  const activeContacts = useMemo(
    () => contacts.filter((contact) => contact.archivedAt === null),
    [contacts],
  );
  const dueContacts = useMemo(
    () =>
      sortContactsByFollowUp(
        activeContacts.filter((contact) => isFollowUpDue(contact, nowMs)),
      ),
    [activeContacts, nowMs],
  );
  const scheduledFollowUps = useMemo(
    () =>
      sortContactsByFollowUp(
        activeContacts.filter((contact) => contact.nextFollowUpAt !== null),
      ),
    [activeContacts],
  );

  const visibleContacts = useMemo(() => {
    const source = filter === "archived" ? archivedContacts : contacts;
    let rows =
      filter === "archived"
        ? [...source]
        : source.filter((contact) => filterContact(contact, filter));
    if (filter === "recent") rows = sortContactsByRecency(rows);
    if (filter === "followup") rows = sortContactsByFollowUp(rows);
    if (searchQuery.trim()) {
      if (filter !== "archived" && searchResultIds) {
        const rank = new Map(searchResultIds.map((id, index) => [id, index]));
        rows = rows
          .filter((contact) => rank.has(contact.id))
          .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
      } else {
        rows = localSearchContacts(rows, searchQuery);
      }
    }
    return rows;
  }, [archivedContacts, contacts, filter, searchQuery, searchResultIds]);

  const selectedContact = useMemo(
    () => [...contacts, ...archivedContacts].find((c) => c.id === selectedId) ?? null,
    [archivedContacts, contacts, selectedId],
  );

  const shouldRenderSplit =
    isSearching ||
    filter === "all" ||
    filter === "followup" ||
    filter === "pinned" ||
    filter === "recent";

  useEffect(() => {
    if (!shouldRenderSplit) return;
    if (selectedId && visibleContacts.some((c) => c.id === selectedId)) return;
    setSelectedId(visibleContacts[0]?.id ?? null);
  }, [selectedId, shouldRenderSplit, visibleContacts]);

  useEffect(() => {
    if (!selectedId) {
      setInteractions([]);
      setBacklinks([]);
      return;
    }
    let cancelled = false;
    contactInteractionsList(selectedId)
      .then((rows) => {
        if (!cancelled) setInteractions(rows);
      })
      .catch((error) => {
        if (!cancelled) {
          setNotice({
            kind: "error",
            text: `Failed to load interactions: ${formatContactsError(error)}`,
          });
        }
      });
    contactsListBacklinks(selectedId)
      .then((rows) => {
        if (!cancelled) setBacklinks(rows);
      })
      .catch((error) => {
        if (!cancelled) {
          setNotice({
            kind: "error",
            text: `Failed to load backlinks: ${formatContactsError(error)}`,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const navCounts = useMemo<ContactsNavCounts>(
    () => ({
      [CONTACTS_HOME_NAV_ID]: dueContacts.length,
      [CONTACTS_FOLLOW_UP_NAV_ID]: dueContacts.length,
      [CONTACTS_ALL_NAV_ID]: activeContacts.length,
      [CONTACTS_PINNED_NAV_ID]: activeContacts.filter((c) => c.pinnedAt !== null)
        .length,
      [CONTACTS_RECENT_NAV_ID]: activeContacts.filter(
        (c) => c.lastInteractionAt !== null,
      ).length,
      [CONTACTS_BIRTHDAYS_NAV_ID]: birthdays.length,
      [CONTACTS_ARCHIVED_NAV_ID]: archivedContacts.length,
    }),
    [activeContacts, archivedContacts.length, birthdays.length, dueContacts.length],
  );

  const navGroups = useMemo(
    () => createContactsNavGroups(navCounts),
    [navCounts],
  );

  useEffect(() => {
    for (const group of navGroups) {
      setNavGroupItems(group.id, group.items);
    }
    return () => {
      for (const group of navGroups) {
        setNavGroupItems(group.id, null);
      }
    };
  }, [navGroups, setNavGroupItems]);

  const upsertContact = (row: ContactRow) => {
    setArchivedContacts((current) => current.filter((c) => c.id !== row.id));
    setContacts((current) =>
      sortContacts([
        ...current.filter((c) => c.id !== row.id),
        row,
      ]),
    );
  };

  const handleCreate = async (params: { displayName: string }) => {
    setNotice(null);
    try {
      const row = await contactsCreate({ displayName: params.displayName });
      upsertContact(row);
      setSelectedId(row.id);
      setActiveNavItemId(CONTACTS_ALL_NAV_ID);
      setShowNewContactDialog(false);
    } catch (error) {
      setNotice({
        kind: "error",
        text: `Failed to create contact: ${formatContactsError(error)}`,
      });
    }
  };

  const handleUpdate = async (
    contact: ContactRow,
    patch: Partial<Omit<ContactRow, "id">>,
  ) => {
    setNotice(null);
    try {
      const row = await contactsUpdate({
        id: contact.id,
        displayName: patch.displayName,
        givenName: patch.givenName,
        familyName: patch.familyName,
        company: patch.company,
        role: patch.role,
        birthdayMonth: patch.birthdayMonth,
        birthdayDay: patch.birthdayDay,
        birthdayYear: patch.birthdayYear,
        emails: patch.emails,
        phones: patch.phones,
        tags: patch.tags,
        notes: patch.notes,
        nextFollowUpAt: patch.nextFollowUpAt,
        cadenceDays: patch.cadenceDays,
        pinned:
          patch.pinnedAt === undefined
            ? undefined
            : patch.pinnedAt !== null,
      });
      upsertContact(row);
    } catch (error) {
      setNotice({
        kind: "error",
        text: `Failed to update contact: ${formatContactsError(error)}`,
      });
    }
  };

  const handleArchive = async (contact: ContactRow) => {
    setNotice(null);
    try {
      await contactsArchive(contact.id);
      const archivedAt = Date.now();
      const archived = { ...contact, archivedAt, updatedAt: archivedAt };
      setContacts((current) => current.filter((c) => c.id !== contact.id));
      setArchivedContacts((current) => [archived, ...current]);
      setUndoContact(archived);
      setNotice({ kind: "info", text: `${contact.displayName} archived.` });
      setSelectedId(null);
    } catch (error) {
      setNotice({
        kind: "error",
        text: `Failed to archive contact: ${formatContactsError(error)}`,
      });
    }
  };

  const handleRestore = async (contact: ContactRow) => {
    setNotice(null);
    try {
      const row = await contactsUnarchive(contact.id);
      setArchivedContacts((current) => current.filter((c) => c.id !== row.id));
      upsertContact(row);
      setUndoContact(null);
      setSelectedId(row.id);
      setActiveNavItemId(CONTACTS_ALL_NAV_ID);
      setNotice({ kind: "info", text: `${row.displayName} restored.` });
    } catch (error) {
      setNotice({
        kind: "error",
        text: `Failed to restore contact: ${formatContactsError(error)}`,
      });
    }
  };

  const handleSyncFromCalendar = async () => {
    if (syncingCalendar) return;
    setSyncingCalendar(true);
    setNotice({ kind: "info", text: "Scanning calendar…" });
    try {
      const result = await contactsDeriveCalendarInteractions();
      const [refreshed, birthdayRows] = await Promise.all([
        contactsList(),
        contactsUpcomingBirthdays(60),
      ]);
      setContacts(sortContacts(refreshed));
      setBirthdays(birthdayRows);
      if (selectedId) {
        const rows = await contactInteractionsList(selectedId);
        setInteractions(rows);
      }
      const summary =
        result.created === 0 && result.skipped === 0
          ? `No matches in ${result.eventsScanned} events.`
          : `${result.created} logged, ${result.skipped} already logged.`;
      setNotice({ kind: "info", text: summary });
    } catch (error) {
      setNotice({
        kind: "error",
        text: `Failed to sync calendar: ${formatContactsError(error)}`,
      });
    } finally {
      setSyncingCalendar(false);
    }
  };

  const handleAddInteraction = async (
    contact: ContactRow,
    kind: InteractionKind,
    note: string,
  ) => {
    setNotice(null);
    try {
      const row = await contactInteractionsCreate({
        contactId: contact.id,
        kind,
        note: note.trim() || null,
      });
      setInteractions((current) => [row, ...current]);
      const refreshed = await contactsGet(contact.id);
      if (refreshed) upsertContact(refreshed);
    } catch (error) {
      setNotice({
        kind: "error",
        text: `Failed to log interaction: ${formatContactsError(error)}`,
      });
    }
  };

  const handleDeleteInteraction = async (interaction: ContactInteractionRow) => {
    setNotice(null);
    try {
      await contactInteractionsDelete(interaction.id);
      setInteractions((current) =>
        current.filter((row) => row.id !== interaction.id),
      );
      if (selectedContact) {
        const refreshed = await contactsGet(selectedContact.id);
        if (refreshed) upsertContact(refreshed);
      }
    } catch (error) {
      setNotice({
        kind: "error",
        text: `Failed to delete interaction: ${formatContactsError(error)}`,
      });
    }
  };

  const openContact = (id: string) => {
    setActiveNavItemId(CONTACTS_ALL_NAV_ID);
    setSelectedId(id);
  };

  const renderSplit = () => {
    if (loading && contacts.length === 0) {
      return <WorkspaceEmptyState className="contacts-empty" title="Loading contacts" />;
    }
    if (visibleContacts.length === 0) {
      return (
        <EmptyState
          filter={filter}
          searching={isSearching}
          onAdd={() => setShowNewContactDialog(true)}
        />
      );
    }
    return (
      <div className="contacts-split">
        <ContactList
          contacts={visibleContacts}
          selectedId={selectedId}
          now={nowMs}
          onSelect={setSelectedId}
        />
        {selectedContact && selectedContact.archivedAt === null ? (
          <ContactDetail
            key={`${selectedContact.id}:${selectedContact.updatedAt}`}
            contact={selectedContact}
            interactions={interactions}
            backlinks={backlinks}
            onOpenNote={(noteId) =>
              selectWorkspaceNavItem("notes", noteNavId(noteId))
            }
            onUpdate={(patch) => void handleUpdate(selectedContact, patch)}
            onArchive={() => void handleArchive(selectedContact)}
            onAddInteraction={(kind, note) =>
              void handleAddInteraction(selectedContact, kind, note)
            }
            onDeleteInteraction={(interaction) =>
              void handleDeleteInteraction(interaction)
            }
          />
        ) : (
          <WorkspaceEmptyState className="contacts-empty" title="Select a contact" />
        )}
      </div>
    );
  };

  return (
    <WorkspaceSurfaceFrame className="contacts-surface">
      <WorkspaceCommandBar
        className="contacts-commandbar"
        leading={
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search contacts…"
            aria-label="Search contacts"
            className="contacts-search-input"
          />
        }
        trailing={
          <WorkspaceCommandGroup align="end">
            <WorkspaceCommandButton
              tone="ghost"
              onClick={() => void handleSyncFromCalendar()}
              disabled={syncingCalendar}
              title="Log matching calendar attendees"
            >
              {syncingCalendar ? "Syncing…" : "Sync calendar"}
            </WorkspaceCommandButton>
            <WorkspaceCommandButton
              tone="accent"
              onClick={() => setShowNewContactDialog(true)}
            >
              <Plus {...iconProps()} />
              New
            </WorkspaceCommandButton>
          </WorkspaceCommandGroup>
        }
      />
      {notice ? (
        <WorkspaceInlineStatus
          className="contacts-message"
          data-kind={notice.kind}
          tone={notice.kind === "error" ? "error" : "success"}
        >
          <span>{notice.text}</span>
          {undoContact ? (
            <button type="button" onClick={() => void handleRestore(undoContact)}>
              Undo
            </button>
          ) : null}
        </WorkspaceInlineStatus>
      ) : null}
      <div className="contacts-body">
        {filter === "archived" ? (
          <ArchivedPane
            contacts={visibleContacts}
            onRestore={(contact) => void handleRestore(contact)}
          />
        ) : isSearching || shouldRenderSplit ? (
          renderSplit()
        ) : filter === "birthdays" ? (
          <BirthdayPane
            birthdays={birthdays}
            contactsById={contacts}
            onSelect={openContact}
          />
        ) : (
          <ContactsHome
            contacts={activeContacts}
            dueContacts={dueContacts}
            scheduledFollowUps={scheduledFollowUps}
            birthdays={birthdays}
            now={nowMs}
            onSelect={openContact}
            onOpenFilter={setActiveNavItemId}
            onAdd={() => setShowNewContactDialog(true)}
          />
        )}
      </div>
      {showNewContactDialog ? (
        <NewContactDialog
          onClose={() => setShowNewContactDialog(false)}
          onSubmit={handleCreate}
        />
      ) : null}
    </WorkspaceSurfaceFrame>
  );
}

function EmptyState({
  filter,
  searching,
  onAdd,
}: {
  filter: ContactsFilter;
  searching: boolean;
  onAdd: () => void;
}) {
  const message = searching
    ? "No matches."
    : filter === "pinned"
      ? "No pinned contacts"
      : filter === "recent"
        ? "No interactions"
        : filter === "followup"
          ? "No follow-ups"
          : "No contacts";
  return (
    <WorkspaceEmptyState
      action={
        !searching ? (
          <button type="button" className="btn btn--primary" onClick={onAdd}>
            <Plus {...iconProps()} />
            New contact
          </button>
        ) : null
      }
      className="contacts-empty"
      title={message}
    />
  );
}

function ContactList({
  contacts,
  selectedId,
  now,
  onSelect,
}: {
  contacts: ContactRow[];
  selectedId: string | null;
  now: number;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="contacts-list" role="listbox">
      {contacts.map((contact) => {
        const email = primaryMethod(contact.emails);
        const subtitle = contact.nextFollowUpAt
          ? `Follow-up ${formatFollowUp(contact.nextFollowUpAt, now)}`
          : [contact.role, contact.company].filter(Boolean).join(" - ") ||
            email?.value ||
            formatLastInteraction(contact.lastInteractionAt);
        return (
          <li key={contact.id}>
            <button
              type="button"
              role="option"
              aria-selected={contact.id === selectedId}
              data-active={contact.id === selectedId ? "true" : undefined}
              className="contacts-list__row"
              onClick={() => onSelect(contact.id)}
            >
              <span className="contacts-list__avatar" aria-hidden="true">
                {getInitials(contact.displayName)}
              </span>
              <span className="contacts-list__body">
                <strong className="contacts-list__name">
                  {contact.displayName}
                  {contact.pinnedAt !== null ? <Pin {...iconProps(12)} /> : null}
                </strong>
                <span
                  className="contacts-list__subtitle"
                  data-due={isFollowUpDue(contact, now) ? "true" : undefined}
                >
                  {subtitle}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ContactsHome({
  contacts,
  dueContacts,
  scheduledFollowUps,
  birthdays,
  now,
  onSelect,
  onOpenFilter,
  onAdd,
}: {
  contacts: ContactRow[];
  dueContacts: ContactRow[];
  scheduledFollowUps: ContactRow[];
  birthdays: UpcomingBirthday[];
  now: number;
  onSelect: (id: string) => void;
  onOpenFilter: (id: string) => void;
  onAdd: () => void;
}) {
  const recent = sortContactsByRecency(
    contacts.filter((contact) => contact.lastInteractionAt !== null),
  ).slice(0, 5);
  const stalePinned = contacts
    .filter((contact) => {
      if (contact.pinnedAt === null) return false;
      const last = contact.lastInteractionAt ?? contact.createdAt;
      return now - last > 60 * DAY_MS;
    })
    .slice(0, 5);
  const upcoming = scheduledFollowUps
    .filter((contact) => !isFollowUpDue(contact, now))
    .slice(0, 5);

  if (contacts.length === 0) {
    return (
      <WorkspaceEmptyState
        action={
          <button type="button" className="btn btn--primary" onClick={onAdd}>
            <Plus {...iconProps()} />
            New contact
          </button>
        }
        className="contacts-empty"
        title="No contacts"
      />
    );
  }

  return (
    <div className="contacts-home">
      <div className="contacts-home__metrics" aria-label="CRM summary">
        <Metric label="Due" value={dueContacts.length} />
        <Metric label="Birthdays" value={birthdays.length} />
        <Metric label="Pinned stale" value={stalePinned.length} />
        <Metric label="People" value={contacts.length} />
      </div>
      <div className="contacts-home__grid">
        <HomePanel
          title="Follow up"
          count={dueContacts.length}
          actionLabel="View"
          onAction={() => onOpenFilter(CONTACTS_FOLLOW_UP_NAV_ID)}
        >
          <MiniContactList
            contacts={dueContacts.slice(0, 6)}
            empty="Nothing due."
            meta={(contact) => formatFollowUp(contact.nextFollowUpAt, now)}
            onSelect={onSelect}
          />
        </HomePanel>
        <HomePanel
          title="Upcoming"
          count={upcoming.length}
          actionLabel="View"
          onAction={() => onOpenFilter(CONTACTS_FOLLOW_UP_NAV_ID)}
        >
          <MiniContactList
            contacts={upcoming}
            empty="No scheduled follow-ups."
            meta={(contact) => formatFollowUp(contact.nextFollowUpAt, now)}
            onSelect={onSelect}
          />
        </HomePanel>
        <HomePanel
          title="Birthdays"
          count={birthdays.length}
          actionLabel="View"
          onAction={() => onOpenFilter(CONTACTS_BIRTHDAYS_NAV_ID)}
        >
          <ul className="contacts-mini-list">
            {birthdays.slice(0, 5).length === 0 ? (
              <li className="contacts-detail__empty">None soon.</li>
            ) : (
              birthdays.slice(0, 5).map((birthday) => (
                <li key={birthday.contactId}>
                  <button
                    type="button"
                    className="contacts-mini-row"
                    onClick={() => onSelect(birthday.contactId)}
                  >
                    <span className="contacts-list__avatar" aria-hidden="true">
                      {getInitials(birthday.displayName)}
                    </span>
                    <span>
                      <strong>{birthday.displayName}</strong>
                      <span>{formatBirthdayCountdown(birthday)}</span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </HomePanel>
        <HomePanel title="Recent" count={recent.length}>
          <MiniContactList
            contacts={recent}
            empty="No interactions yet."
            meta={(contact) => formatLastInteraction(contact.lastInteractionAt)}
            onSelect={onSelect}
          />
        </HomePanel>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="contacts-home__metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function HomePanel({
  title,
  count,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  count: number;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="contacts-home__panel">
      <header>
        <h3>{title}</h3>
        <span>{count}</span>
        {actionLabel && onAction ? (
          <button type="button" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function MiniContactList({
  contacts,
  empty,
  meta,
  onSelect,
}: {
  contacts: ContactRow[];
  empty: string;
  meta: (contact: ContactRow) => string;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="contacts-mini-list">
      {contacts.length === 0 ? (
        <li className="contacts-detail__empty">{empty}</li>
      ) : (
        contacts.map((contact) => (
          <li key={contact.id}>
            <button
              type="button"
              className="contacts-mini-row"
              onClick={() => onSelect(contact.id)}
            >
              <span className="contacts-list__avatar" aria-hidden="true">
                {getInitials(contact.displayName)}
              </span>
              <span>
                <strong>{contact.displayName}</strong>
                <span>{meta(contact)}</span>
              </span>
            </button>
          </li>
        ))
      )}
    </ul>
  );
}

function ContactDetail({
  contact,
  interactions,
  backlinks,
  onOpenNote,
  onUpdate,
  onArchive,
  onAddInteraction,
  onDeleteInteraction,
}: {
  contact: ContactRow;
  interactions: ContactInteractionRow[];
  backlinks: ContactBacklink[];
  onOpenNote: (noteId: string) => void;
  onUpdate: (patch: Partial<Omit<ContactRow, "id">>) => void;
  onArchive: () => void;
  onAddInteraction: (kind: InteractionKind, note: string) => void;
  onDeleteInteraction: (interaction: ContactInteractionRow) => void;
}) {
  const [nameDraft, setNameDraft] = useState(contact.displayName);
  const [companyDraft, setCompanyDraft] = useState(contact.company ?? "");
  const [roleDraft, setRoleDraft] = useState(contact.role ?? "");
  const [emailDraft, setEmailDraft] = useState(
    primaryMethod(contact.emails)?.value ?? "",
  );
  const [phoneDraft, setPhoneDraft] = useState(
    primaryMethod(contact.phones)?.value ?? "",
  );
  const [tagsDraft, setTagsDraft] = useState(contact.tags.join(", "));
  const [notesDraft, setNotesDraft] = useState(contact.notes);
  const [followUpDraft, setFollowUpDraft] = useState(
    dateInputValue(contact.nextFollowUpAt),
  );
  const [cadenceDraft, setCadenceDraft] = useState(
    contact.cadenceDays?.toString() ?? "",
  );
  const [birthMonthDraft, setBirthMonthDraft] = useState(
    contact.birthdayMonth?.toString() ?? "",
  );
  const [birthDayDraft, setBirthDayDraft] = useState(
    contact.birthdayDay?.toString() ?? "",
  );
  const [birthYearDraft, setBirthYearDraft] = useState(
    contact.birthdayYear?.toString() ?? "",
  );
  const [interactionKind, setInteractionKind] = useState<InteractionKind>(
    "meeting",
  );
  const [interactionNote, setInteractionNote] = useState("");
  const [nowMs] = useState(() => Date.now());

  const commitTags = () => {
    const next = tagsDraft
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (JSON.stringify(next) === JSON.stringify(contact.tags)) return;
    onUpdate({ tags: next });
  };

  const commitMethod = (field: "emails" | "phones", value: string) => {
    const trimmed = value.trim();
    const current = field === "emails" ? contact.emails : contact.phones;
    const currentPrimary = primaryMethod(current)?.value ?? "";
    if (trimmed === currentPrimary) return;
    if (!trimmed) {
      onUpdate({ [field]: [] } as Partial<ContactRow>);
      return;
    }
    onUpdate({
      [field]: [{ value: trimmed, label: null, isPrimary: true }],
    } as Partial<ContactRow>);
  };

  const commitFollowUp = () => {
    const next = timestampFromDateInput(followUpDraft);
    if (next === contact.nextFollowUpAt) return;
    onUpdate({ nextFollowUpAt: next });
  };

  const commitCadence = () => {
    const raw = cadenceDraft.trim();
    const next = raw ? Number.parseInt(raw, 10) : null;
    if (next === contact.cadenceDays) return;
    if (next !== null && (!Number.isFinite(next) || next < 1)) return;
    onUpdate({ cadenceDays: next });
  };

  const commitBirthday = () => {
    const monthRaw = birthMonthDraft.trim();
    const dayRaw = birthDayDraft.trim();
    const yearRaw = birthYearDraft.trim();
    if (!monthRaw && !dayRaw && !yearRaw) {
      if (
        contact.birthdayMonth === null &&
        contact.birthdayDay === null &&
        contact.birthdayYear === null
      ) {
        return;
      }
      onUpdate({
        birthdayMonth: null,
        birthdayDay: null,
        birthdayYear: null,
      });
      return;
    }
    const month = Number.parseInt(monthRaw, 10);
    const day = Number.parseInt(dayRaw, 10);
    const year = yearRaw ? Number.parseInt(yearRaw, 10) : null;
    if (
      !Number.isFinite(month) ||
      !Number.isFinite(day) ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      return;
    }
    onUpdate({
      birthdayMonth: month,
      birthdayDay: day,
      birthdayYear: Number.isFinite(year as number) ? (year as number) : null,
    });
  };

  const submitInteraction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onAddInteraction(interactionKind, interactionNote);
    setInteractionNote("");
  };

  const birthdayText =
    formatBirthday(
      contact.birthdayMonth,
      contact.birthdayDay,
      contact.birthdayYear,
    ) ?? "No birthday";

  return (
    <article className="contacts-detail" aria-label="Contact details">
      <header className="contacts-detail__header">
        <span className="contacts-detail__avatar" aria-hidden="true">
          {getInitials(contact.displayName)}
        </span>
        <div className="contacts-detail__heading">
          <input
            type="text"
            className="contacts-detail__name"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              const next = nameDraft.trim();
              if (!next || next === contact.displayName) {
                setNameDraft(contact.displayName);
                return;
              }
              onUpdate({ displayName: next });
            }}
          />
          <p className="contacts-detail__subtitle">
            {[contact.role, contact.company].filter(Boolean).join(" - ") ||
              formatLastInteraction(contact.lastInteractionAt)}
          </p>
        </div>
        <div className="contacts-detail__actions">
          <button
            type="button"
            className="btn"
            data-active={contact.pinnedAt !== null ? "true" : undefined}
            onClick={() =>
              onUpdate({
                pinnedAt: contact.pinnedAt === null ? Date.now() : null,
              })
            }
            title={contact.pinnedAt !== null ? "Unpin" : "Pin"}
          >
            {contact.pinnedAt !== null ? (
              <PinOff {...iconProps()} />
            ) : (
              <Pin {...iconProps()} />
            )}
            {contact.pinnedAt !== null ? "Unpin" : "Pin"}
          </button>
          <button type="button" className="btn" onClick={onArchive}>
            <Archive {...iconProps()} />
            Archive
          </button>
        </div>
      </header>

      <section className="contacts-detail__signals" aria-label="Relationship signals">
        <Signal
          icon={<History {...iconProps(16)} />}
          label="Last touch"
          value={formatLastInteraction(contact.lastInteractionAt)}
        />
        <Signal
          icon={<UserRoundCheck {...iconProps(16)} />}
          label="Next follow-up"
          value={formatFollowUp(contact.nextFollowUpAt, nowMs)}
          urgent={isFollowUpDue(contact, nowMs)}
        />
        <Signal
          icon={<Cake {...iconProps(16)} />}
          label="Birthday"
          value={birthdayText}
        />
      </section>

      <section className="contacts-detail__action-panel" aria-label="Next action">
        <div className="contacts-detail__action-head">
          <div>
            <span>Next Action</span>
            <strong>{formatFollowUp(contact.nextFollowUpAt, nowMs)}</strong>
          </div>
          <div className="contacts-detail__quick-actions">
            <button
              type="button"
              onClick={() => onUpdate({ nextFollowUpAt: Date.now() + 7 * DAY_MS })}
            >
              7d
            </button>
            <button
              type="button"
              onClick={() => onUpdate({ nextFollowUpAt: Date.now() + 30 * DAY_MS })}
            >
              30d
            </button>
            <button type="button" onClick={() => onUpdate({ nextFollowUpAt: null })}>
              Clear
            </button>
          </div>
        </div>
        <form
          className="contacts-detail__interaction-form"
          onSubmit={submitInteraction}
        >
          <select
            value={interactionKind}
            onChange={(e) => setInteractionKind(e.target.value as InteractionKind)}
            aria-label="Interaction kind"
          >
            {INTERACTION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={interactionNote}
            onChange={(e) => setInteractionNote(e.target.value)}
            placeholder="Short note…"
          />
          <button type="submit" className="btn btn--primary">
            Log
          </button>
        </form>
      </section>

      <details className="contacts-detail__more">
        <summary>Follow-up</summary>
        <section className="contacts-detail__section" aria-label="Follow-up">
          <div className="contacts-detail__grid contacts-detail__grid--compact">
            <label className="contacts-detail__field">
              <span>Next follow-up</span>
              <input
                type="date"
                value={followUpDraft}
                onChange={(e) => setFollowUpDraft(e.target.value)}
                onBlur={commitFollowUp}
              />
            </label>
            <label className="contacts-detail__field">
              <span>Cadence days</span>
              <input
                type="number"
                min={1}
                value={cadenceDraft}
                onChange={(e) => setCadenceDraft(e.target.value)}
                onBlur={commitCadence}
                placeholder="-"
              />
            </label>
          </div>
        </section>
      </details>

      <details className="contacts-detail__more">
        <summary>Notes</summary>
        <section className="contacts-detail__section" aria-label="Notes">
          <label className="contacts-detail__field contacts-detail__field--block">
            <span>Notes</span>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={() => {
                if (notesDraft === contact.notes) return;
                onUpdate({ notes: notesDraft });
              }}
              rows={5}
              placeholder="Context, preferences, open loops…"
            />
          </label>
        </section>
      </details>

      <details className="contacts-detail__more">
        <summary>Profile</summary>
        <section className="contacts-detail__section" aria-label="Contact info">
          <div className="contacts-detail__grid">
            <label className="contacts-detail__field">
              <span>Company</span>
              <input
                type="text"
                value={companyDraft}
                onChange={(e) => setCompanyDraft(e.target.value)}
                onBlur={() => {
                  const next = companyDraft.trim();
                  if (next === (contact.company ?? "")) return;
                  onUpdate({ company: next || null });
                }}
                placeholder="-"
              />
            </label>
            <label className="contacts-detail__field">
              <span>Role</span>
              <input
                type="text"
                value={roleDraft}
                onChange={(e) => setRoleDraft(e.target.value)}
                onBlur={() => {
                  const next = roleDraft.trim();
                  if (next === (contact.role ?? "")) return;
                  onUpdate({ role: next || null });
                }}
                placeholder="-"
              />
            </label>
            <label className="contacts-detail__field">
              <span>Email</span>
              <input
                type="email"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                onBlur={() => commitMethod("emails", emailDraft)}
                placeholder="-"
              />
            </label>
            <label className="contacts-detail__field">
              <span>Phone</span>
              <input
                type="tel"
                value={phoneDraft}
                onChange={(e) => setPhoneDraft(e.target.value)}
                onBlur={() => commitMethod("phones", phoneDraft)}
                placeholder="-"
              />
            </label>
          </div>
        </section>
        <section className="contacts-detail__section" aria-label="Birthday and tags">
          <div className="contacts-detail__birthday">
            <span className="contacts-detail__field-label">Birthday</span>
            <input
              type="number"
              min={1}
              max={12}
              value={birthMonthDraft}
              onChange={(e) => setBirthMonthDraft(e.target.value)}
              onBlur={commitBirthday}
              aria-label="Birthday month"
              placeholder="MM"
            />
            <input
              type="number"
              min={1}
              max={31}
              value={birthDayDraft}
              onChange={(e) => setBirthDayDraft(e.target.value)}
              onBlur={commitBirthday}
              aria-label="Birthday day"
              placeholder="DD"
            />
            <input
              type="number"
              min={1900}
              max={2200}
              value={birthYearDraft}
              onChange={(e) => setBirthYearDraft(e.target.value)}
              onBlur={commitBirthday}
              aria-label="Birthday year"
              placeholder="YYYY"
            />
          </div>
          <label className="contacts-detail__field">
            <span>Tags</span>
            <input
              type="text"
              value={tagsDraft}
              onChange={(e) => setTagsDraft(e.target.value)}
              onBlur={commitTags}
              placeholder="friend, mentor…"
            />
          </label>
        </section>
      </details>

      <section className="contacts-detail__section" aria-label="Recent interactions">
        <h3 className="contacts-detail__section-heading">Timeline</h3>
        <ul className="contacts-detail__interactions">
          {interactions.length === 0 ? (
            <li className="contacts-detail__empty">No interactions</li>
          ) : (
            interactions.map((entry) => (
              <li key={entry.id} className="contacts-detail__interaction">
                <div>
                  <strong>{entry.kind}</strong>
                  <span>
                    {new Date(entry.occurredAt).toLocaleString(undefined, {
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>
                {entry.note ? <p>{entry.note}</p> : null}
                <button
                  type="button"
                  className="contacts-detail__interaction-delete"
                  onClick={() => onDeleteInteraction(entry)}
                  aria-label={`Delete ${entry.kind} interaction`}
                >
                  <Trash2 {...iconProps(13)} />
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      <details className="contacts-detail__more">
        <summary>Linked Notes {backlinks.length}</summary>
        <section className="contacts-detail__section" aria-label="Mentioned in">
          {backlinks.length === 0 ? (
            <p className="contacts-detail__empty">No linked notes</p>
          ) : (
            <ul className="contacts-detail__backlinks">
              {backlinks.map((link) => (
                <li key={`${link.noteId}:${link.charOffset}`}>
                  <button
                    type="button"
                    className="contacts-detail__backlink"
                    onClick={() => onOpenNote(link.noteId)}
                  >
                    <span aria-hidden="true">
                      {link.noteIcon ?? <StickyNote {...iconProps(15)} />}
                    </span>
                    <span className="contacts-detail__backlink-body">
                      <strong>{link.noteTitle || "(Untitled note)"}</strong>
                      <span>{formatShortDate(link.noteUpdatedAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </details>
    </article>
  );
}

function Signal({
  icon,
  label,
  value,
  urgent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  urgent?: boolean;
}) {
  return (
    <div className="contacts-signal" data-urgent={urgent ? "true" : undefined}>
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </div>
  );
}

function BirthdayPane({
  birthdays,
  contactsById,
  onSelect,
}: {
  birthdays: UpcomingBirthday[];
  contactsById: ContactRow[];
  onSelect: (id: string) => void;
}) {
  if (birthdays.length === 0) {
    return (
      <WorkspaceEmptyState
        className="contacts-empty"
        title="No upcoming birthdays"
      />
    );
  }
  const lookup = new Map(contactsById.map((c) => [c.id, c]));
  return (
    <div className="contacts-birthdays">
      <ul className="contacts-birthdays__list">
        {birthdays.map((b) => {
          const contact = lookup.get(b.contactId);
          return (
            <li key={b.contactId}>
              <button
                type="button"
                className="contacts-birthdays__row"
                onClick={() => onSelect(b.contactId)}
              >
                <span className="contacts-list__avatar" aria-hidden="true">
                  {getInitials(b.displayName)}
                </span>
                <span className="contacts-birthdays__body">
                  <strong>{b.displayName}</strong>
                  <span>
                    {formatBirthday(b.birthdayMonth, b.birthdayDay, b.birthdayYear)}
                    {b.turningAge !== null ? ` - turns ${b.turningAge}` : ""}
                  </span>
                  {contact?.role || contact?.company ? (
                    <span>
                      {[contact?.role, contact?.company].filter(Boolean).join(" - ")}
                    </span>
                  ) : null}
                </span>
                <span className="contacts-birthdays__countdown">
                  {formatBirthdayCountdown(b)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ArchivedPane({
  contacts,
  onRestore,
}: {
  contacts: ContactRow[];
  onRestore: (contact: ContactRow) => void;
}) {
  if (contacts.length === 0) {
    return (
      <WorkspaceEmptyState className="contacts-empty" title="Archive is empty" />
    );
  }
  return (
    <div className="contacts-archived">
      <ul className="contacts-archived__list">
        {contacts.map((contact) => (
          <li key={contact.id}>
            <div className="contacts-archived__row">
              <span className="contacts-list__avatar" aria-hidden="true">
                {getInitials(contact.displayName)}
              </span>
              <span className="contacts-archived__body">
                <strong>{contact.displayName}</strong>
                <span>
                  {contact.archivedAt ? `Archived ${formatShortDate(contact.archivedAt)}` : ""}
                </span>
              </span>
              <button type="button" className="btn" onClick={() => onRestore(contact)}>
                <ArchiveRestore {...iconProps()} />
                Restore
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewContactDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (params: { displayName: string }) => void;
}) {
  const [name, setName] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="contacts-dialog-backdrop" role="presentation" onClick={onClose}>
      <form
        className="contacts-dialog"
        role="dialog"
        aria-label="New contact"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          onSubmit({ displayName: name });
        }}
      >
        <h2>New contact</h2>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Display name"
          aria-label="Display name"
        />
        <div className="contacts-dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={!name.trim()}
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
