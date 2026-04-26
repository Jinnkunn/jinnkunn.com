import { Suspense, lazy } from "react";

import type { MarkdownEditorProps } from "./MarkdownEditor";

const MarkdownEditorImpl = lazy(() =>
  import("./MarkdownEditor").then((module) => ({
    default: module.MarkdownEditor,
  })),
);

export function MarkdownEditor(props: MarkdownEditorProps) {
  const minHeight = props.minHeight ?? 360;
  return (
    <Suspense
      fallback={
        <div
          className="markdown-editor-skeleton"
          style={{ minHeight }}
          role="status"
        >
          Loading editor…
        </div>
      }
    >
      <MarkdownEditorImpl {...props} />
    </Suspense>
  );
}
