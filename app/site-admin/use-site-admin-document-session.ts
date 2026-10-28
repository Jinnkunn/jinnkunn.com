"use client";
import { useRef, useState } from "react";
import { createSelectionGate } from "./site-admin-console-model";
import { EMPTY_CONTENT_FORM, type EditableContentForm, type EditableKind } from "./site-admin-document-model";
import type { LocalDraftSnapshot as StoredDraft } from "./site-admin-draft-storage";

export type EditableDetail = {
  raw?: boolean; kind: EditableKind; id: string; title: string; href: string;
  meta: string; version: string; source: string;
};
export type LocalDraftSnapshot = StoredDraft<EditableContentForm>;

/** A selected document owns its form, recovery state and request identity together. */
export function useSiteAdminDocumentSession() {
  const [selected, setSelected] = useState<EditableDetail | null>(null);
  const [sourceDraft, setSourceDraft] = useState("");
  const [contentForm, setContentForm] = useState<EditableContentForm>(EMPTY_CONTENT_FORM);
  const [contentFormBaseline, setContentFormBaseline] = useState("");
  const [slugDraft, setSlugDraft] = useState("");
  const [localAutosaveAt, setLocalAutosaveAt] = useState("");
  const [recoveredDocumentNeedsReview, setRecoveredDocumentNeedsReview] = useState(false);
  const [contentSavedAt, setContentSavedAt] = useState("");
  const [localDraftSnapshot, setLocalDraftSnapshot] = useState<LocalDraftSnapshot | null>(null);
  const selectionGateRef = useRef(createSelectionGate());
  const selectionLoadingRef = useRef("");
  const selectedSourceDraftRef = useRef("");
  function updateContentField<Key extends keyof EditableContentForm>(key: Key, value: EditableContentForm[Key]) {
    // Capture the primitive before React can defer or replay a state updater.
    setContentForm((current) => ({ ...current, [key]: value }));
  }
  return {
    selected, setSelected, sourceDraft, setSourceDraft, contentForm, setContentForm,
    contentFormBaseline, setContentFormBaseline, slugDraft, setSlugDraft,
    localAutosaveAt, setLocalAutosaveAt, recoveredDocumentNeedsReview, setRecoveredDocumentNeedsReview,
    contentSavedAt, setContentSavedAt, localDraftSnapshot, setLocalDraftSnapshot,
    selectionGateRef, selectionLoadingRef, selectedSourceDraftRef,
    updateContentField,
  };
}
