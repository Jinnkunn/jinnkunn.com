import type {
  NewsDraftEntry,
  PublicationDraftEntry,
  TeachingDraftEntry,
  WorksDraftEntry,
} from "./site-admin-structured-collection-model";
import { formatMonthRangePeriod, parseMonthRangePeriod, type MonthRangeValue } from "./site-admin-month-range.ts";

export type StructuredCollectionFieldOption = {
  label: string;
  value: string;
};

export type StructuredCollectionFieldSchema<T extends { id: string }> = {
  key: string;
  label: string;
  control?: "input" | "textarea" | "select" | "month-range" | "term" | "list" | "markdown" | "combobox";
  section?: string;
  readList?: (item: T) => string[];
  writeList?: (item: T, values: string[]) => T;
  readRange?: (item: T) => MonthRangeValue;
  writeRange?: (item: T, range: MonthRangeValue) => T;
  inputType?: "text" | "date" | "url";
  placeholder?: string;
  wide?: boolean;
  options?:
    | readonly StructuredCollectionFieldOption[]
    | ((item: T) => readonly StructuredCollectionFieldOption[]);
  read: (item: T) => string;
  write: (item: T, value: string) => T;
};

function stringField<T extends { id: string }, K extends keyof T>(
  key: K,
  label: string,
  options: Omit<StructuredCollectionFieldSchema<T>, "key" | "label" | "read" | "write"> = {},
): StructuredCollectionFieldSchema<T> {
  return {
    key: String(key),
    label,
    ...options,
    read: (item) => String(item[key] ?? ""),
    write: (item, value) => ({ ...item, [key]: value }) as T,
  };
}

function commaList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function publicationAuthorNames(item: PublicationDraftEntry) {
  if (item.authors?.length) return item.authors;
  return (item.authorsRich || []).map((author) => author.name).filter(Boolean);
}

function writePublicationAuthors(item: PublicationDraftEntry, value: string) {
  const names = commaList(value);
  return writePublicationAuthorList(item, names);
}

function writePublicationAuthorList(item: PublicationDraftEntry, names: string[]) {
  const existing = new Map((item.authorsRich || []).map((author) => [author.name, author]));
  return {
    ...item,
    authors: names,
    authorsRich: names.map((name) => existing.get(name) || { name, isSelf: false }),
  };
}

function publicationSelfAuthor(item: PublicationDraftEntry) {
  return item.authorsRich?.find((author) => author.isSelf)?.name || "";
}

function writePublicationSelfAuthor(item: PublicationDraftEntry, selfAuthor: string) {
  const names = publicationAuthorNames(item);
  const existing = new Map((item.authorsRich || []).map((author) => [author.name, author]));
  return {
    ...item,
    authors: names,
    authorsRich: names.map((name) => ({ ...existing.get(name), name, isSelf: name === selfAuthor })),
  };
}

function primaryPublicationVenue(item: PublicationDraftEntry) {
  return (
    (item.venues || []).find(
      (venue) => !/^(doi|arxiv(?:\.org)?)$/i.test(String(venue.type || "").trim()),
    ) || null
  );
}

function writePrimaryPublicationVenue(
  item: PublicationDraftEntry,
  field: "text" | "type" | "url",
  value: string,
) {
  const venues = [...(item.venues || [])];
  const venueIndex = venues.findIndex(
    (venue) => !/^(doi|arxiv(?:\.org)?)$/i.test(String(venue.type || "").trim()),
  );
  const current =
    venueIndex >= 0 ? venues[venueIndex] : { type: "Venue", text: item.venue || "" };
  const next = { ...current, [field]: value };
  if (venueIndex >= 0) venues[venueIndex] = next;
  else venues.unshift(next);
  return { ...item, venue: next.text, venues };
}

function publicationListField(
  key: "labels" | "highlights" | "externalUrls",
  label: string,
): StructuredCollectionFieldSchema<PublicationDraftEntry> {
  return {
    key,
    label,
    section: key === "externalUrls" ? "Links" : "Venue",
    control: "list",
    readList: (item) => item[key] || [],
    writeList: (item, values) => ({ ...item, [key]: values }),
    read: (item) => (item[key] || []).join(", "),
    write: (item, value) => ({ ...item, [key]: commaList(value) }),
  };
}

export const NEWS_ENTRY_FIELDS: readonly StructuredCollectionFieldSchema<NewsDraftEntry>[] = [
  stringField<NewsDraftEntry, "date">("date", "Date", { inputType: "date" }),
  stringField<NewsDraftEntry, "body">("body", "Body", {
    control: "markdown",
    wide: true,
  }),
];

export const TEACHING_ENTRY_FIELDS: readonly StructuredCollectionFieldSchema<TeachingDraftEntry>[] = [
  stringField<TeachingDraftEntry, "term">("term", "Term", { control: "term" }),
  periodField<TeachingDraftEntry>(),
  stringField<TeachingDraftEntry, "role">("role", "Role", {
    control: "combobox",
    options: ["Instructor", "Teaching Assistant", "Marker", "Guest Lecturer"].map((value) => ({ value, label: value })),
  }),
  stringField<TeachingDraftEntry, "courseCode">("courseCode", "Course code"),
  stringField<TeachingDraftEntry, "courseName">("courseName", "Course name"),
  stringField<TeachingDraftEntry, "instructor">("instructor", "Instructor"),
  stringField<TeachingDraftEntry, "courseUrl">("courseUrl", "Course URL", {
    inputType: "url",
  }),
];

export const WORKS_ENTRY_FIELDS: readonly StructuredCollectionFieldSchema<WorksDraftEntry>[] = [
  {
    key: "category",
    label: "Category",
    control: "select",
    options: [
      { value: "recent", label: "Recent" },
      { value: "passed", label: "Past" },
    ],
    read: (item) => item.category,
    write: (item, value) => ({
      ...item,
      category: value === "passed" ? "passed" : "recent",
    }),
  },
  stringField<WorksDraftEntry, "role">("role", "Role"),
  stringField<WorksDraftEntry, "affiliation">("affiliation", "Affiliation"),
  stringField<WorksDraftEntry, "affiliationUrl">(
    "affiliationUrl",
    "Affiliation URL",
    { inputType: "url" },
  ),
  stringField<WorksDraftEntry, "location">("location", "Location"),
  periodField<WorksDraftEntry>(),
  stringField<WorksDraftEntry, "body">("body", "Body", {
    control: "markdown",
    wide: true,
  }),
];

export const PUBLICATION_ENTRY_FIELDS: readonly StructuredCollectionFieldSchema<PublicationDraftEntry>[] = [
  stringField<PublicationDraftEntry, "title">("title", "Title", { section: "Publication" }),
  stringField<PublicationDraftEntry, "year">("year", "Year", { section: "Publication" }),
  stringField<PublicationDraftEntry, "url">("url", "URL", { inputType: "url", section: "Links" }),
  {
    key: "authors",
    label: "Authors",
    section: "Authors",
    control: "list",
    placeholder: "Author name",
    readList: publicationAuthorNames,
    writeList: writePublicationAuthorList,
    read: (item) => publicationAuthorNames(item).join(", "),
    write: writePublicationAuthors,
  },
  {
    key: "selfAuthor",
    label: "Highlighted author",
    section: "Authors",
    control: "select",
    options: (item) => [
      { value: "", label: "None" },
      ...publicationAuthorNames(item).map((name) => ({ value: name, label: name })),
    ],
    read: publicationSelfAuthor,
    write: writePublicationSelfAuthor,
  },
  {
    key: "venue",
    label: "Venue",
    section: "Venue",
    placeholder: "Conference or journal",
    read: (item) => primaryPublicationVenue(item)?.text || item.venue || "",
    write: (item, value) => writePrimaryPublicationVenue(item, "text", value),
  },
  {
    key: "venueType",
    label: "Venue type",
    section: "Venue",
    control: "combobox",
    options: ["Conference", "Journal", "Workshop", "Preprint"].map((value) => ({ value, label: value })),
    placeholder: "Conference, Journal, Workshop",
    read: (item) => primaryPublicationVenue(item)?.type || "",
    write: (item, value) => writePrimaryPublicationVenue(item, "type", value),
  },
  {
    key: "venueUrl",
    label: "Venue URL",
    section: "Venue",
    inputType: "url",
    placeholder: "Optional",
    read: (item) => primaryPublicationVenue(item)?.url || "",
    write: (item, value) => writePrimaryPublicationVenue(item, "url", value),
  },
  publicationListField("labels", "Labels"),
  publicationListField("highlights", "Highlights"),
  stringField<PublicationDraftEntry, "doiUrl">("doiUrl", "DOI URL", {
    inputType: "url",
    section: "Links",
  }),
  stringField<PublicationDraftEntry, "arxivUrl">("arxivUrl", "arXiv URL", {
    inputType: "url",
    section: "Links",
  }),
  publicationListField("externalUrls", "External URLs"),
];

function periodField<T extends { id: string; period: string; periodRange?: MonthRangeValue }>(): StructuredCollectionFieldSchema<T> {
  return {
    key: "period", label: "Period", control: "month-range", wide: true,
    read: (item) => item.period,
    write: (item, period) => ({ ...item, period, periodRange: undefined }),
    readRange: (item) => item.periodRange || parseMonthRangePeriod(item.period),
    writeRange: (item, periodRange) => ({ ...item, periodRange, period: formatMonthRangePeriod(periodRange) }),
  };
}

export function structuredCollectionSearchValues<T extends { id: string }>(
  item: T,
  fields: readonly StructuredCollectionFieldSchema<T>[],
) {
  return fields.map((field) => field.read(item));
}
