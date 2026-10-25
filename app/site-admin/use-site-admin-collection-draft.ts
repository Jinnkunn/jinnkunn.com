"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { isSiteComponentName } from "@jinnkunn/content-core/components";
import { documentSourceProblems } from "@/lib/shared/document-draft-validation";
import { parseCollectionDraft, serializeCollectionDraft, undoCollectionDraft, redoCollectionDraft, type CollectionDraft, type CollectionHistory } from "./site-admin-collection-draft";
import { componentEntryFingerprint, newsEntryIssues, teachingEntryIssues, worksEntryIssues, publicationEntryIssues } from "./site-admin-structured-collection-model";

export function useSiteAdminCollectionDraft(selected: { kind: string; id: string; source: string } | null, sourceDraft: string) {
  const [collectionHistory, setCollectionHistory] = useState<CollectionHistory | null>(null);
  const [collectionBaseline, setCollectionBaseline] = useState("");
  const selectedComponentName = selected?.kind === "components" && isSiteComponentName(selected.id) ? selected.id : null;
  const collectionDraft = collectionHistory?.present.name === selectedComponentName ? collectionHistory.present : null;
  const collectionDraftRef = useRef<CollectionDraft | null>(null);
  useEffect(() => { collectionDraftRef.current = collectionDraft; }, [collectionDraft]);
  const collectionSource = useMemo(() => collectionDraft ? serializeCollectionDraft(collectionDraft) : sourceDraft, [collectionDraft, sourceDraft]);
  const selectedNewsDraft = collectionDraft?.name === "news" ? collectionDraft.value : null;
  const selectedTeachingDraft = collectionDraft?.name === "teaching" ? collectionDraft.value : null;
  const selectedWorksDraft = collectionDraft?.name === "works" ? collectionDraft.value : null;
  const selectedPublicationsDraft = collectionDraft?.name === "publications" ? collectionDraft.value : null;
  const hasStructuredDraft = Boolean(collectionDraft);
  const selectedComponentIssues = useMemo(() => {
    if (selectedNewsDraft) return selectedNewsDraft.items.flatMap((item) => item.type === "entry" ? newsEntryIssues(item) : []);
    if (selectedTeachingDraft) return selectedTeachingDraft.items.flatMap(teachingEntryIssues);
    if (selectedWorksDraft) return selectedWorksDraft.items.flatMap(worksEntryIssues);
    if (selectedPublicationsDraft) return selectedPublicationsDraft.items.flatMap(publicationEntryIssues);
    return [];
  }, [selectedNewsDraft, selectedTeachingDraft, selectedWorksDraft, selectedPublicationsDraft]);
  const componentBaselineFingerprints = useMemo(() => {
    if (!selectedComponentName || !selected || !hasStructuredDraft) return new Map<string, string>();
    const baseline: CollectionDraft = collectionBaseline ? JSON.parse(collectionBaseline) : parseCollectionDraft(selectedComponentName, selected.source);
    return new Map(baseline.value.items.map((item) => [item.id, componentEntryFingerprint(item)]));
  }, [selectedComponentName, selected, hasStructuredDraft, collectionBaseline]);
  const componentSaveProblems = useMemo(() => selected?.kind === "components" ? documentSourceProblems(collectionSource) : [], [selected?.kind, collectionSource]);
  const checkpointCollectionEdit = () => setCollectionHistory((current) => current ? { ...current, group: "" } : null);
  const undo = () => setCollectionHistory((current) => current ? undoCollectionDraft(current) : null);
  const redo = () => setCollectionHistory((current) => current ? redoCollectionDraft(current) : null);
  return { collectionHistory, setCollectionHistory, collectionBaseline, setCollectionBaseline, selectedComponentName, collectionDraft, collectionDraftRef, collectionSource, selectedNewsDraft, selectedTeachingDraft, selectedWorksDraft, selectedPublicationsDraft, selectedComponentIssues, componentBaselineFingerprints, componentSaveProblems, componentSaveBlocked: componentSaveProblems.length > 0, checkpointCollectionEdit, undo, redo };
}
