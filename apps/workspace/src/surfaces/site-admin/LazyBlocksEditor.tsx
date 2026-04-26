import { Suspense, lazy } from "react";

import type { BlocksEditorProps } from "./MdxDocumentEditor";

const BlocksEditorImpl = lazy(() =>
  import("./MdxDocumentEditor").then((module) => ({
    default: module.BlocksEditor,
  })),
);

export type { BlocksEditorProps };

export function BlocksEditor(props: BlocksEditorProps) {
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
      <BlocksEditorImpl {...props} />
    </Suspense>
  );
}
