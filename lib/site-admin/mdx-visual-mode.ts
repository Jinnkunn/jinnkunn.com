export type VisualEditorMode = "visual" | "source" | "preview";

export function isVisualModeAvailable({
  visualEditing,
  compatible,
  mode,
  value,
  lastVisualValue,
}: {
  visualEditing: boolean;
  compatible: boolean;
  mode: VisualEditorMode;
  value: string;
  lastVisualValue: string | null;
}) {
  if (!visualEditing) return false;
  if (compatible) return true;

  // The visual editor can only emit Markdown it currently represents. Keep
  // that editing session alive even if the stricter source-import analyzer
  // sees a transient unsupported shape while the user is typing.
  return mode === "visual" && lastVisualValue !== null && value === lastVisualValue;
}
