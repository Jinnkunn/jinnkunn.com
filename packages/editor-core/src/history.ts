import type { EditorDocument, EditorTransaction } from "./types.ts";

export type EditorHistory = {
  document: EditorDocument;
  undoStack: EditorTransaction[];
  redoStack: EditorTransaction[];
};

export function createEditorHistory(document: EditorDocument): EditorHistory {
  return {
    document,
    undoStack: [],
    redoStack: [],
  };
}

export function applyTransaction(history: EditorHistory, transaction: EditorTransaction): EditorHistory {
  return {
    document: transaction.after,
    undoStack: [...history.undoStack, transaction],
    redoStack: [],
  };
}

export function undo(history: EditorHistory): EditorHistory {
  const transaction = history.undoStack.at(-1);
  if (!transaction) return history;
  return {
    document: transaction.before,
    undoStack: history.undoStack.slice(0, -1),
    redoStack: [transaction, ...history.redoStack],
  };
}

export function redo(history: EditorHistory): EditorHistory {
  const transaction = history.redoStack[0];
  if (!transaction) return history;
  return {
    document: transaction.after,
    undoStack: [...history.undoStack, transaction],
    redoStack: history.redoStack.slice(1),
  };
}
