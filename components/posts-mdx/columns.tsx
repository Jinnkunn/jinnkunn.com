import "server-only";

import type { ReactElement, ReactNode } from "react";

type ColumnsCount = 2 | 3;
type ColumnsVariant = "classicIntro";
type ColumnsGap = "compact" | "standard" | "loose";
type ColumnsAlign = "start" | "center";

interface ColumnsProps {
  /** Number of columns. Defaults to 2. */
  count?: ColumnsCount;
  /** Optional variant to apply — currently `classicIntro` reuses the
   * existing Home builder CSS so migrations from the legacy
   * sections-builder keep their visual layout (image left + text right
   * with a 1fr/2fr grid). */
  variant?: ColumnsVariant;
  gap?: ColumnsGap;
  align?: ColumnsAlign;
  children?: ReactNode;
}

interface ColumnProps {
  children?: ReactNode;
}

/** Notion-style multi-column container. Pair with `<Column>` children
 * to split content side-by-side. Renders into the same `home-layout`
 * markup the original Home builder used so the existing CSS rules for
 * `cols-N`, `variant-classicIntro`, and `gap-*` apply unchanged. */
export function Columns({
  count = 2,
  variant,
  gap = "standard",
  align = "start",
  children,
}: ColumnsProps): ReactElement {
  const className = [
    "home-layout",
    `home-layout--cols-${count}`,
    variant ? `home-layout--variant-${variant}` : null,
    `home-layout--gap-${gap}`,
    `home-layout--align-${align}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={className}>
      <div className="home-layout__grid">{children}</div>
    </section>
  );
}

/** Single column inside a `<Columns>` container. Renders the column
 * wrapper so the parent grid can lay it out; children inside flow as
 * normal MDX (markdown, images, JSX). Standalone use outside
 * `<Columns>` just renders a flex column. */
export function Column({ children }: ColumnProps): ReactElement {
  return <div className="home-layout__column">{children}</div>;
}
