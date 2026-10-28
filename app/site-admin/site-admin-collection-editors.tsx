"use client";
import type { ComponentProps, Dispatch, DragEvent, MutableRefObject, SetStateAction } from "react";
import { StructuredCollectionDivider, StructuredCollectionEditor, StructuredCollectionEmpty, StructuredCollectionEntry, StructuredCollectionEntryForm } from "./site-admin-structured-collection-editor";
import { componentEntryState as deriveComponentEntryState, componentItemMatches as matchesComponentItem, type ComponentEntryIssue, type ComponentGrouping, type NewsComponentDraft, type TeachingComponentDraft, type WorksComponentDraft, type PublicationsComponentDraft } from "./site-admin-structured-collection-model";
import { NEWS_ENTRY_FIELDS, TEACHING_ENTRY_FIELDS, WORKS_ENTRY_FIELDS, PUBLICATION_ENTRY_FIELDS, structuredCollectionSearchValues } from "./site-admin-structured-collection-schema";
import { collectionPlainText, groupCollectionItems, type CollectionDraft } from "./site-admin-collection-draft";
import type { createCollectionActions } from "./site-admin-collection-actions";
import type { CollectionGroupEdit } from "./site-admin-collection-group-dialog";

type Props = {
  draft: CollectionDraft;
  actions: ReturnType<typeof createCollectionActions>;
  collectionEditorActions: Pick<ComponentProps<typeof StructuredCollectionEditor>, "canUndo" | "canRedo" | "onUndo" | "onRedo" | "onCheckpoint" | "status" | "statusDetail" | "onSave" | "saveDisabled" | "onPublish" | "publishDisabled">;
  componentSearch: string; setComponentSearch: (value: string) => void;
  componentGrouping: ComponentGrouping; setComponentGrouping: (value: ComponentGrouping) => void;
  componentExpandedIds: string[]; setComponentExpandedIds: (ids: string[]) => void;
  selectedComponentIssues: ComponentEntryIssue[]; reviewComponentIssue: (direction: -1 | 1) => void;
  selected: { id: string; title: string } | null; collectionSource: string; applyCollectionSource: (source: string) => void;
  blockingMutation: boolean;
  componentDragId: string; componentDropId: string;
  setComponentDragId: (id: string) => void; setComponentDropId: (id: string) => void;
  handleComponentDragStart: (event: DragEvent<HTMLElement>, id: string) => void;
  handleComponentDragOver: (event: DragEvent<HTMLElement>, id: string) => void;
  handleComponentDrop: (event: DragEvent<HTMLElement>, id: string) => void;
  issuesForComponentEntry: (id: string) => ComponentEntryIssue[];
  componentBaselineFingerprints: Map<string, string>; toggleComponentEntry: (id: string) => void;
  addCourseToTerm: (term: string) => void; setGroupEdit: Dispatch<SetStateAction<CollectionGroupEdit | null>>;
  teachingDefaultsRef: MutableRefObject<Map<string, { role: string; period: string }>>;
};
export function SiteAdminCollectionEditors({
  draft, actions, collectionEditorActions, componentSearch, setComponentSearch, componentGrouping, setComponentGrouping,
  componentExpandedIds, setComponentExpandedIds, selectedComponentIssues, reviewComponentIssue, selected, collectionSource,
  applyCollectionSource, blockingMutation, componentDragId, componentDropId, setComponentDragId, setComponentDropId,
  handleComponentDragStart, handleComponentDragOver, handleComponentDrop, issuesForComponentEntry, componentBaselineFingerprints,
  toggleComponentEntry, addCourseToTerm, setGroupEdit, teachingDefaultsRef,
}: Props) {
  const { addNewsEntry, addNewsDivider, updateNewsItem, deleteNewsItem, duplicateNewsItem, moveSelectedNewsItem,
    updateTeachingItem, deleteTeachingItem, duplicateTeachingItem, moveSelectedTeachingItem,
    addWorksEntry, updateWorksItem, deleteWorksItem, duplicateWorksItem, moveSelectedWorksItem,
    addPublicationEntry, updatePublicationItem, deletePublicationItem, duplicatePublicationItem, moveSelectedPublicationItem } = actions;
  function renderNewsEditor(draft: NewsComponentDraft) {
    const searching = Boolean(componentSearch.trim());
    const items = draft.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (item.type === "divider") return !searching;
        return matchesComponentItem(
          componentSearch,
          structuredCollectionSearchValues(item, NEWS_ENTRY_FIELDS),
        );
      });

    return (
      <StructuredCollectionEditor
        key="news"
        {...collectionEditorActions}
        title="News entries"
        description="Edit dated updates directly. The public News page keeps using the same reusable collection."
        count={draft.items.filter((item) => item.type === "entry").length}
        entryLabel="updates"
        addLabel="Add update"
        onAdd={addNewsEntry}
        secondaryLabel="Add divider"
        onSecondary={addNewsDivider}
        search={componentSearch}
        onSearchChange={setComponentSearch}
        grouping={componentGrouping}
        onGroupingChange={setComponentGrouping}
        visibleEntryIds={items
          .filter(({ item }) => item.type === "entry")
          .map(({ item }) => item.id)}
        expandedEntryIds={componentExpandedIds}
        onExpandedEntryIdsChange={setComponentExpandedIds}
        issueCount={selectedComponentIssues.length}
        onReviewIssues={() => reviewComponentIssue(1)}
        onReviewPreviousIssue={() => reviewComponentIssue(-1)}
        onReviewNextIssue={() => reviewComponentIssue(1)}
        source={{
          fileName: `${selected?.id || "news"}.mdx`,
          label: `${selected?.title || "News"} MDX source`,
          value: collectionSource,
          onChange: applyCollectionSource,
          disabled: blockingMutation,
        }}
      >
        {items.length === 0 ? (
          <StructuredCollectionEmpty noun="updates" searching={searching} />
        ) : null}
        {items.map(({ item, index }, visibleIndex) => {
          const previousItem = items[visibleIndex - 1]?.item;
          const groupLabel =
            item.type === "entry" ? item.date.slice(0, 4) || "Undated" : "";
          const previousGroup =
            previousItem?.type === "entry"
              ? previousItem.date.slice(0, 4) || "Undated"
              : "";
          const clearDragState = () => {
            setComponentDragId("");
            setComponentDropId("");
          };
          if (item.type === "divider") {
            return (
              <StructuredCollectionDivider
                key={item.id}
                dragging={componentDragId === item.id}
                dropTarget={componentDropId === item.id}
                dragDisabled={searching}
                index={index}
                count={draft.items.length}
                onMove={(direction) => moveSelectedNewsItem(item.id, direction)}
                onDelete={() => deleteNewsItem(item.id)}
                onDragStart={(event) => handleComponentDragStart(event, item.id)}
                onDragEnd={clearDragState}
                onDragOver={(event) => handleComponentDragOver(event, item.id)}
                onDrop={(event) => handleComponentDrop(event, item.id)}
              />
            );
          }
          const issues = issuesForComponentEntry(item.id);
          return (
            <StructuredCollectionEntry
              key={item.id}
              id={item.id}
              groupLabel={groupLabel}
              previousGroupLabel={previousGroup}
              grouping={componentGrouping}
              title={collectionPlainText(item.body) || "Untitled update"}
              detail={item.date || "No date"}
              state={deriveComponentEntryState(componentBaselineFingerprints, item)}
              issues={issues}
              expanded={componentExpandedIds.includes(item.id)}
              dragging={componentDragId === item.id}
              dropTarget={componentDropId === item.id}
              dragDisabled={searching}
              index={index}
              count={draft.items.length}
              onToggle={() => toggleComponentEntry(item.id)}
              onMove={(direction) => moveSelectedNewsItem(item.id, direction)}
              onDuplicate={() => duplicateNewsItem(item.id)}
              onDelete={() => deleteNewsItem(item.id)}
              onDragStart={(event) => handleComponentDragStart(event, item.id)}
              onDragEnd={clearDragState}
              onDragOver={(event) => handleComponentDragOver(event, item.id)}
              onDrop={(event) => handleComponentDrop(event, item.id)}
            >
              <StructuredCollectionEntryForm
                item={item}
                fields={NEWS_ENTRY_FIELDS}
                issues={issues}
                disabled={blockingMutation}
                onChange={updateNewsItem}
              />
            </StructuredCollectionEntry>
          );
        })}
      </StructuredCollectionEditor>
    );
  }

  function renderTeachingEditor(draft: TeachingComponentDraft) {
    const searching = Boolean(componentSearch.trim());
    const ordered = componentGrouping === "auto"
      ? groupCollectionItems(draft.items, (item) => item.term) : draft.items;
    const items = ordered
      .map((item) => ({ item, index: draft.items.findIndex((entry) => entry.id === item.id) }))
      .filter(({ item }) =>
        matchesComponentItem(
          componentSearch,
          structuredCollectionSearchValues(item, TEACHING_ENTRY_FIELDS),
        ),
      );
    return (
      <StructuredCollectionEditor
        key="teaching"
        {...collectionEditorActions}
        title="Teaching rows"
        description="Edit course rows directly. The MDX source remains available under Advanced."
        count={draft.items.length}
        entryLabel="courses"
        addLabel="Add course"
        onAdd={() => addCourseToTerm(draft.items.find((item) => componentExpandedIds.includes(item.id))?.term || draft.items[0]?.term || "")}
        secondaryLabel="New term"
        onSecondary={() => setGroupEdit({ kind: "teaching", term: null, role: "", period: "", count: 0 })}
        search={componentSearch}
        onSearchChange={setComponentSearch}
        grouping={componentGrouping}
        onGroupingChange={setComponentGrouping}
        visibleEntryIds={items.map(({ item }) => item.id)}
        expandedEntryIds={componentExpandedIds}
        onExpandedEntryIdsChange={setComponentExpandedIds}
        issueCount={selectedComponentIssues.length}
        onReviewIssues={() => reviewComponentIssue(1)}
        onReviewPreviousIssue={() => reviewComponentIssue(-1)}
        onReviewNextIssue={() => reviewComponentIssue(1)}
        source={{
          fileName: `${selected?.id || "teaching"}.mdx`,
          label: `${selected?.title || "Teaching"} MDX source`,
          value: collectionSource,
          onChange: applyCollectionSource,
          disabled: blockingMutation,
        }}
      >
        {items.length === 0 ? (
          <StructuredCollectionEmpty noun="courses" searching={searching} />
        ) : null}
        {items.map(({ item, index }, visibleIndex) => {
          const issues = issuesForComponentEntry(item.id);
          const groupLabel = item.term || "No term";
          const previousTerm = items[visibleIndex - 1]?.item.term || "";
          const previousGroup = previousTerm;
          return (
            <StructuredCollectionEntry
              key={item.id}
              id={item.id}
              groupLabel={groupLabel}
              previousGroupLabel={previousGroup}
              grouping={componentGrouping}
              title={item.courseCode || item.courseName || item.term || "Untitled course"}
              detail={item.term || item.period || "Course"}
              description={[item.courseName, item.role].filter(Boolean).join(" · ")}
              onAddToGroup={() => addCourseToTerm(item.term)}
              groupCount={draft.items.filter((entry) => entry.term === item.term).length}
              onEditGroup={() => setGroupEdit({ kind: "teaching", term: item.term, ...(teachingDefaultsRef.current.get(item.term) || { role: item.role, period: item.period }), count: draft.items.filter((entry) => entry.term === item.term).length })}
              state={deriveComponentEntryState(componentBaselineFingerprints, item)}
              issues={issues}
              expanded={componentExpandedIds.includes(item.id)}
              dragging={componentDragId === item.id}
              dropTarget={componentDropId === item.id}
              dragDisabled={searching}
              index={index}
              count={draft.items.length}
              onToggle={() => toggleComponentEntry(item.id)}
              onMove={(direction) => moveSelectedTeachingItem(item.id, direction)}
              onDuplicate={() => duplicateTeachingItem(item.id)}
              onDelete={() => deleteTeachingItem(item.id)}
              onDragStart={(event) => handleComponentDragStart(event, item.id)}
              onDragEnd={() => {
                setComponentDragId("");
                setComponentDropId("");
              }}
              onDragOver={(event) => handleComponentDragOver(event, item.id)}
              onDrop={(event) => handleComponentDrop(event, item.id)}
            >
              <StructuredCollectionEntryForm
                item={item}
                fields={TEACHING_ENTRY_FIELDS}
                issues={issues}
                disabled={blockingMutation}
                onChange={updateTeachingItem}
              />
            </StructuredCollectionEntry>
          );
        })}
      </StructuredCollectionEditor>
    );
  }

  function renderWorksEditor(draft: WorksComponentDraft) {
    const searching = Boolean(componentSearch.trim());
    const ordered = componentGrouping === "auto"
      ? groupCollectionItems(draft.items, (item) => item.category) : draft.items;
    const items = ordered
      .map((item) => ({ item, index: draft.items.findIndex((entry) => entry.id === item.id) }))
      .filter(({ item }) =>
        matchesComponentItem(
          componentSearch,
          structuredCollectionSearchValues(item, WORKS_ENTRY_FIELDS),
        ),
      );
    return (
      <StructuredCollectionEditor
        key="works"
        {...collectionEditorActions}
        title="Work rows"
        description="Edit roles, affiliations, periods, and body text without touching MDX tags."
        count={draft.items.length}
        entryLabel="roles"
        addLabel="Add role"
        onAdd={() => addWorksEntry()}
        search={componentSearch}
        onSearchChange={setComponentSearch}
        grouping={componentGrouping}
        onGroupingChange={setComponentGrouping}
        visibleEntryIds={items.map(({ item }) => item.id)}
        expandedEntryIds={componentExpandedIds}
        onExpandedEntryIdsChange={setComponentExpandedIds}
        issueCount={selectedComponentIssues.length}
        onReviewIssues={() => reviewComponentIssue(1)}
        onReviewPreviousIssue={() => reviewComponentIssue(-1)}
        onReviewNextIssue={() => reviewComponentIssue(1)}
        source={{
          fileName: `${selected?.id || "works"}.mdx`,
          label: `${selected?.title || "Works"} MDX source`,
          value: collectionSource,
          onChange: applyCollectionSource,
          disabled: blockingMutation,
        }}
      >
        {items.length === 0 ? (
          <StructuredCollectionEmpty noun="roles" searching={searching} />
        ) : null}
        {items.map(({ item, index }, visibleIndex) => {
          const issues = issuesForComponentEntry(item.id);
          const groupLabel = item.category === "passed" ? "Past" : "Recent";
          const previousItem = items[visibleIndex - 1]?.item;
          const previousGroup = previousItem
            ? previousItem.category === "passed"
              ? "Past"
              : "Recent"
            : "";
          return (
            <StructuredCollectionEntry
              key={item.id}
              id={item.id}
              groupLabel={groupLabel}
              previousGroupLabel={previousGroup}
              grouping={componentGrouping}
              title={item.role || item.affiliation || "Untitled work"}
              detail={item.period || item.category}
              description={[item.affiliation, item.location].filter(Boolean).join(" · ")}
              onAddToGroup={() => addWorksEntry(item.category)}
              groupCount={draft.items.filter((entry) => entry.category === item.category).length}
              onEditGroup={() => setGroupEdit({ kind: "works", category: item.category, count: draft.items.filter((entry) => entry.category === item.category).length })}
              state={deriveComponentEntryState(componentBaselineFingerprints, item)}
              issues={issues}
              expanded={componentExpandedIds.includes(item.id)}
              dragging={componentDragId === item.id}
              dropTarget={componentDropId === item.id}
              dragDisabled={searching}
              index={index}
              count={draft.items.length}
              onToggle={() => toggleComponentEntry(item.id)}
              onMove={(direction) => moveSelectedWorksItem(item.id, direction)}
              onDuplicate={() => duplicateWorksItem(item.id)}
              onDelete={() => deleteWorksItem(item.id)}
              onDragStart={(event) => handleComponentDragStart(event, item.id)}
              onDragEnd={() => {
                setComponentDragId("");
                setComponentDropId("");
              }}
              onDragOver={(event) => handleComponentDragOver(event, item.id)}
              onDrop={(event) => handleComponentDrop(event, item.id)}
            >
              <StructuredCollectionEntryForm
                item={item}
                fields={WORKS_ENTRY_FIELDS}
                issues={issues}
                disabled={blockingMutation}
                onChange={updateWorksItem}
              />
            </StructuredCollectionEntry>
          );
        })}
      </StructuredCollectionEditor>
    );
  }

  function renderPublicationsEditor(draft: PublicationsComponentDraft) {
    const searching = Boolean(componentSearch.trim());
    const ordered = componentGrouping === "auto"
      ? groupCollectionItems(draft.items, (item) => item.year) : draft.items;
    const items = ordered
      .map((item) => ({ item, index: draft.items.findIndex((entry) => entry.id === item.id) }))
      .filter(({ item }) =>
        matchesComponentItem(
          componentSearch,
          structuredCollectionSearchValues(item, PUBLICATION_ENTRY_FIELDS),
        ),
      );
    return (
      <StructuredCollectionEditor
        key="publications"
        {...collectionEditorActions}
        title="Publication rows"
        description="Edit titles, authors, venue, links, and labels directly. Advanced JSON remains preserved."
        count={draft.items.length}
        entryLabel="publications"
        addLabel="Add publication"
        onAdd={() => addPublicationEntry(draft.items.find((item) => componentExpandedIds.includes(item.id))?.year || undefined)}
        search={componentSearch}
        onSearchChange={setComponentSearch}
        grouping={componentGrouping}
        onGroupingChange={setComponentGrouping}
        visibleEntryIds={items.map(({ item }) => item.id)}
        expandedEntryIds={componentExpandedIds}
        onExpandedEntryIdsChange={setComponentExpandedIds}
        issueCount={selectedComponentIssues.length}
        onReviewIssues={() => reviewComponentIssue(1)}
        onReviewPreviousIssue={() => reviewComponentIssue(-1)}
        onReviewNextIssue={() => reviewComponentIssue(1)}
        source={{
          fileName: `${selected?.id || "publications"}.mdx`,
          label: `${selected?.title || "Publications"} MDX source`,
          value: collectionSource,
          onChange: applyCollectionSource,
          disabled: blockingMutation,
        }}
      >
        {items.length === 0 ? (
          <StructuredCollectionEmpty noun="publications" searching={searching} />
        ) : null}
        {items.map(({ item, index }, visibleIndex) => {
          const issues = issuesForComponentEntry(item.id);
          const previousGroup = items[visibleIndex - 1]?.item.year || "";
          return (
            <StructuredCollectionEntry
              key={item.id}
              id={item.id}
              groupLabel={item.year || "No year"}
              previousGroupLabel={previousGroup}
              grouping={componentGrouping}
              title={item.title || "Untitled publication"}
              detail={item.year || "Publication"}
              description={(item.authors || item.authorsRich?.map((author) => author.name) || []).join(", ")}
              onAddToGroup={() => addPublicationEntry(item.year)}
              groupCount={draft.items.filter((entry) => entry.year === item.year).length}
              onEditGroup={() => setGroupEdit({ kind: "publications", year: item.year, count: draft.items.filter((entry) => entry.year === item.year).length })}
              state={deriveComponentEntryState(componentBaselineFingerprints, item)}
              issues={issues}
              expanded={componentExpandedIds.includes(item.id)}
              dragging={componentDragId === item.id}
              dropTarget={componentDropId === item.id}
              dragDisabled={searching}
              index={index}
              count={draft.items.length}
              onToggle={() => toggleComponentEntry(item.id)}
              onMove={(direction) => moveSelectedPublicationItem(item.id, direction)}
              onDuplicate={() => duplicatePublicationItem(item.id)}
              onDelete={() => deletePublicationItem(item.id)}
              onDragStart={(event) => handleComponentDragStart(event, item.id)}
              onDragEnd={() => {
                setComponentDragId("");
                setComponentDropId("");
              }}
              onDragOver={(event) => handleComponentDragOver(event, item.id)}
              onDrop={(event) => handleComponentDrop(event, item.id)}
            >
              <StructuredCollectionEntryForm
                item={item}
                fields={PUBLICATION_ENTRY_FIELDS}
                issues={issues}
                disabled={blockingMutation}
                onChange={updatePublicationItem}
              />
            </StructuredCollectionEntry>
          );
        })}
      </StructuredCollectionEditor>
    );
  }

  switch (draft.name) {
    case "news": return renderNewsEditor(draft.value);
    case "teaching": return renderTeachingEditor(draft.value);
    case "works": return renderWorksEditor(draft.value);
    case "publications": return renderPublicationsEditor(draft.value);
  }
}

