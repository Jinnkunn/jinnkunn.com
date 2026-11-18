import "server-only";

import { PublicationRow } from "@/components/publications/publication-list";
import { parsePublicationEntryData } from "@/lib/components/parse";
import { identifyPublications } from "@/lib/shared/publication-identity";

export function PublicationsEntry({ data }: { data?: string }) {
  const entry = parsePublicationEntryData(data);
  return entry ? <PublicationRow entry={identifyPublications([entry])[0]} /> : null;
}
