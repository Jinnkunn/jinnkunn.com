import type { ReactNode } from "react";

type SpecialStatePageProps = {
  badge: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children?: ReactNode;
  tone?: "default" | "danger" | "locked";
  layout?: "stacked" | "inline";
};

export function SpecialStatePage({
  badge,
  title,
  description,
  actions,
  children,
  tone = "default",
  layout = "stacked",
}: SpecialStatePageProps) {
  const isInline = layout === "inline";
  return (
    <main className={`page-state super-content page-state--${tone}`}>
      <section className="page-state__panel" aria-live="polite">
        {isInline ? (
          <div className="page-state__inline" role="status" aria-label={`${badge}: ${title}`}>
            <div className="page-state__badge page-state__badge--inline">{badge}</div>
            <span className="page-state__divider" aria-hidden="true" />
            <p className="page-state__inline-text">{title}</p>
          </div>
        ) : (
          <>
            <div className="page-state__badge">{badge}</div>
            <h1 className="page-state__title">{title}</h1>
            <p className="page-state__desc">{description}</p>
          </>
        )}
        {isInline && description ? <p className="page-state__desc">{description}</p> : null}
        {children ? <div className="page-state__body">{children}</div> : null}
        {actions ? <div className="page-state__actions">{actions}</div> : null}
      </section>
    </main>
  );
}
