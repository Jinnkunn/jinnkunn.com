import type { ReactNode } from "react";

// Wraps a single block in a tinted background. Mirrors the editor's
// MdxBlock.color field. The MDX serializer emits <Color bg="..."> around
// the block source; this component renders the wrapped children with a
// data-color attribute that notion-blocks.css picks up.
export function Color({ bg, children }: { bg?: string; children?: ReactNode }) {
  return (
    <div className="notion-color mdx-color" data-color={bg ?? "default"}>
      {children}
    </div>
  );
}
