import type { Dispatch, SetStateAction } from "react";
import { commitCollectionDraft, type CollectionHistory, type CollectionDraft } from "./site-admin-collection-draft.ts";
import {
  createComponentEntryId, moveDraftEntry, reorderDraftEntries, todayInHalifax,
  type NewsComponentDraft, type NewsDraftEntry, type TeachingComponentDraft, type TeachingDraftEntry,
  type WorksComponentDraft, type WorksDraftEntry, type PublicationsComponentDraft, type PublicationDraftEntry,
} from "./site-admin-structured-collection-model.ts";
import { reorderWorksEntriesAcrossGroups } from "./site-admin-works-drag.ts";

export function createCollectionActions({
  setCollectionHistory, setComponentExpandedIds, setComponentSearch, selectedComponentName, componentSearch, teachingTerm,
}: {
  setCollectionHistory: Dispatch<SetStateAction<CollectionHistory | null>>;
  setComponentExpandedIds: Dispatch<SetStateAction<string[]>>;
  setComponentSearch: Dispatch<SetStateAction<string>>;
  selectedComponentName: CollectionDraft["name"] | null;
  componentSearch: string;
  teachingTerm: string;
}) {
  function updateNewsDraft(
    updater: (draft: NewsComponentDraft) => NewsComponentDraft,
    group = "",
  ) {
    setCollectionHistory((current) => current?.present.name === "news"
      ? commitCollectionDraft(current, { name: "news", value: updater(current.present.value) }, group) : current);
  }

  function addNewsEntry() {
    const id = createComponentEntryId("news");
    updateNewsDraft((draft) => ({
      ...draft,
      items: [
        {
          id,
          type: "entry",
          date: todayInHalifax(),
          body: "",
        },
        ...draft.items,
      ],
    }));
    setComponentExpandedIds([id]);
    setComponentSearch("");
  }

  function addNewsDivider() {
    const id = createComponentEntryId("divider");
    updateNewsDraft((draft) => ({
      ...draft,
      items: [
        {
          id,
          type: "divider",
        },
        ...draft.items,
      ],
    }));
  }

  function updateNewsItem(nextItem: NewsDraftEntry) {
    updateNewsDraft((draft) => ({
      ...draft,
      items: draft.items.map((item) => {
        if (item.id !== nextItem.id || item.type !== "entry") return item;
        return nextItem;
      }),
    }), `edit:${nextItem.id}`);
  }

  function deleteNewsItem(id: string) {
    updateNewsDraft((draft) => ({
      ...draft,
      items: draft.items.filter((item) => item.id !== id),
    }));
    setComponentExpandedIds((current) => current.filter((entryId) => entryId !== id));
  }

  function duplicateNewsItem(id: string) {
    const copyId = createComponentEntryId("news");
    updateNewsDraft((draft) => {
      const index = draft.items.findIndex((item) => item.id === id);
      const source = draft.items[index];
      if (!source || source.type !== "entry") return draft;
      const copy = { ...source, id: copyId };
      return {
        ...draft,
        items: [...draft.items.slice(0, index + 1), copy, ...draft.items.slice(index + 1)],
      };
    });
    setComponentExpandedIds([copyId]);
    setComponentSearch("");
  }

  function moveSelectedNewsItem(id: string, direction: -1 | 1) {
    updateNewsDraft((draft) => ({
      ...draft,
      items: moveDraftEntry(
        draft.items,
        draft.items.findIndex((item) => item.id === id),
        direction,
      ),
    }));
  }

  function updateTeachingDraft(
    updater: (draft: TeachingComponentDraft) => TeachingComponentDraft,
    group = "",
  ) {
    setCollectionHistory((current) => current?.present.name === "teaching"
      ? commitCollectionDraft(current, { name: "teaching", value: updater(current.present.value) }, group) : current);
  }

  function addTeachingEntry(term = teachingTerm) {
    const id = createComponentEntryId("teaching");
    updateTeachingDraft((draft) => ({
      ...draft,
      items: [
        {
          id,
          term,
          period: "",
          role: "",
          courseCode: "",
          courseName: "",
        },
        ...draft.items,
      ],
    }));
    setComponentExpandedIds([id]);
    setComponentSearch("");
  }

  function updateTeachingItem(nextItem: TeachingDraftEntry) {
    updateTeachingDraft((draft) => ({
      ...draft,
      items: draft.items.map((item) =>
        item.id === nextItem.id ? nextItem : item,
      ),
    }), `edit:${nextItem.id}`);
  }

  function deleteTeachingItem(id: string) {
    updateTeachingDraft((draft) => ({
      ...draft,
      items: draft.items.filter((item) => item.id !== id),
    }));
    setComponentExpandedIds((current) => current.filter((entryId) => entryId !== id));
  }

  function duplicateTeachingItem(id: string) {
    const copyId = createComponentEntryId("teaching");
    updateTeachingDraft((draft) => {
      const index = draft.items.findIndex((item) => item.id === id);
      const source = draft.items[index];
      if (!source) return draft;
      const copy = { ...source, id: copyId };
      return {
        ...draft,
        items: [...draft.items.slice(0, index + 1), copy, ...draft.items.slice(index + 1)],
      };
    });
    setComponentExpandedIds([copyId]);
    setComponentSearch("");
  }

  function moveSelectedTeachingItem(id: string, direction: -1 | 1) {
    updateTeachingDraft((draft) => ({
      ...draft,
      items: moveDraftEntry(
        draft.items,
        draft.items.findIndex((item) => item.id === id),
        direction,
      ),
    }));
  }

  function updateWorksDraft(updater: (draft: WorksComponentDraft) => WorksComponentDraft, group = "") {
    setCollectionHistory((current) => current?.present.name === "works"
      ? commitCollectionDraft(current, { name: "works", value: updater(current.present.value) }, group) : current);
  }

  function addWorksEntry(category: WorksDraftEntry["category"] = "recent") {
    const id = createComponentEntryId("works");
    updateWorksDraft((draft) => ({
      ...draft,
      items: [
        {
          id,
          category,
          role: "",
          affiliation: "",
          location: "",
          period: "",
          body: "",
        },
        ...draft.items,
      ],
    }));
    setComponentExpandedIds([id]);
    setComponentSearch("");
  }

  function updateWorksItem(nextItem: WorksDraftEntry) {
    updateWorksDraft((draft) => ({
      ...draft,
      items: draft.items.map((item) =>
        item.id === nextItem.id ? nextItem : item,
      ),
    }), `edit:${nextItem.id}`);
  }

  function deleteWorksItem(id: string) {
    updateWorksDraft((draft) => ({
      ...draft,
      items: draft.items.filter((item) => item.id !== id),
    }));
    setComponentExpandedIds((current) => current.filter((entryId) => entryId !== id));
  }

  function duplicateWorksItem(id: string) {
    const copyId = createComponentEntryId("works");
    updateWorksDraft((draft) => {
      const index = draft.items.findIndex((item) => item.id === id);
      const source = draft.items[index];
      if (!source) return draft;
      const copy = { ...source, id: copyId };
      return {
        ...draft,
        items: [...draft.items.slice(0, index + 1), copy, ...draft.items.slice(index + 1)],
      };
    });
    setComponentExpandedIds([copyId]);
    setComponentSearch("");
  }

  function moveSelectedWorksItem(id: string, direction: -1 | 1) {
    updateWorksDraft((draft) => ({
      ...draft,
      items: moveDraftEntry(
        draft.items,
        draft.items.findIndex((item) => item.id === id),
        direction,
      ),
    }));
  }

  function updatePublicationsDraft(
    updater: (draft: PublicationsComponentDraft) => PublicationsComponentDraft,
    group = "",
  ) {
    setCollectionHistory((current) => current?.present.name === "publications"
      ? commitCollectionDraft(current, { name: "publications", value: updater(current.present.value) }, group) : current);
  }

  function addPublicationEntry(year = new Date().getFullYear().toString()) {
    const id = createComponentEntryId("publication");
    updatePublicationsDraft((draft) => ({
      ...draft,
      items: [
        {
          id,
          title: "",
          year,
          url: "",
          labels: [],
        },
        ...draft.items,
      ],
    }));
    setComponentExpandedIds([id]);
    setComponentSearch("");
  }

  function updatePublicationItem(nextItem: PublicationDraftEntry) {
    updatePublicationsDraft((draft) => ({
      ...draft,
      items: draft.items.map((item) =>
        item.id === nextItem.id ? nextItem : item,
      ),
    }), `edit:${nextItem.id}`);
  }

  function deletePublicationItem(id: string) {
    updatePublicationsDraft((draft) => ({
      ...draft,
      items: draft.items.filter((item) => item.id !== id),
    }));
    setComponentExpandedIds((current) => current.filter((entryId) => entryId !== id));
  }

  function duplicatePublicationItem(id: string) {
    const copyId = createComponentEntryId("publication");
    updatePublicationsDraft((draft) => {
      const index = draft.items.findIndex((item) => item.id === id);
      const source = draft.items[index];
      if (!source) return draft;
      const copy = { ...source, id: copyId };
      return {
        ...draft,
        items: [...draft.items.slice(0, index + 1), copy, ...draft.items.slice(index + 1)],
      };
    });
    setComponentExpandedIds([copyId]);
    setComponentSearch("");
  }

  function moveSelectedPublicationItem(id: string, direction: -1 | 1) {
    updatePublicationsDraft((draft) => ({
      ...draft,
      items: moveDraftEntry(
        draft.items,
        draft.items.findIndex((item) => item.id === id),
        direction,
      ),
    }));
  }

  function reorderSelectedComponentItems(sourceId: string, targetId: string) {
    if (!sourceId || !targetId || componentSearch.trim()) return;
    if (selectedComponentName === "news") {
      updateNewsDraft((draft) => ({
        ...draft,
        items: reorderDraftEntries(draft.items, sourceId, targetId),
      }));
    } else if (selectedComponentName === "teaching") {
      updateTeachingDraft((draft) => ({
        ...draft,
        items: reorderDraftEntries(draft.items, sourceId, targetId),
      }));
    } else if (selectedComponentName === "works") {
      updateWorksDraft((draft) => ({
        ...draft,
        items: reorderWorksEntriesAcrossGroups(draft.items, sourceId, targetId),
      }));
    } else if (selectedComponentName === "publications") {
      updatePublicationsDraft((draft) => ({
        ...draft,
        items: reorderDraftEntries(draft.items, sourceId, targetId),
      }));
    }
  }

  return {
    addNewsEntry, addNewsDivider, updateNewsItem, deleteNewsItem,
    duplicateNewsItem, moveSelectedNewsItem,
    addTeachingEntry, updateTeachingItem, deleteTeachingItem,
    duplicateTeachingItem, moveSelectedTeachingItem,
    addWorksEntry, updateWorksItem, deleteWorksItem,
    duplicateWorksItem, moveSelectedWorksItem,
    addPublicationEntry, updatePublicationItem, deletePublicationItem,
    duplicatePublicationItem, moveSelectedPublicationItem,
    reorderSelectedComponentItems,
  };
}
