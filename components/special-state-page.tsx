import type { ReactNode } from "react";

type SpecialStatePageProps = {
  badge: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children?: ReactNode;
  tone?: "default" | "danger" | "locked";
};

export function SpecialStatePage({
  badge,
  title,
  description,
  actions,
  children,
  tone = "default",
}: SpecialStatePageProps) {
  return (
    <main className={`page-state super-content page-state--${tone}`}>
      <section className="page-state__panel" aria-live="polite">
        <div className="page-state__badge">{badge}</div>
        <h1 className="page-state__title">{title}</h1>
        <p className="page-state__desc">{description}</p>
        {children ? <div className="page-state__body">{children}</div> : null}
        {actions ? <div className="page-state__actions">{actions}</div> : null}
      </section>
    </main>
  );
}

