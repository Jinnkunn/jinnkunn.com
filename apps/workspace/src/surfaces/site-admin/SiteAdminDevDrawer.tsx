import { useEffect } from "react";
import { ResponsePane } from "./ResponsePane";
import { useSiteAdmin } from "./state";

/** Bottom-docked collapsible drawer that hosts the debug ResponsePane (and
 * could host future dev tooling — request history, raw token view, etc.).
 * Hidden by default; toggled via topbar button or ⌘\. Mounts the keyboard
 * handler once so every surface mount listens; cheap. */
export function SiteAdminDevDrawer() {
  const { drawerOpen, toggleDrawer, setDrawerOpen } = useSiteAdmin();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // ⌘\ or Ctrl+\ — toggle drawer. Ignore when focus is in an input-like
      // element to avoid stealing `\` from editors, but still honor the
      // explicit modifier combo.
      if (event.key !== "\\") return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      toggleDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleDrawer]);

  if (!drawerOpen) return null;

  return (
    <aside
      className="site-admin-dev-drawer"
      role="complementary"
      aria-label="Debug drawer"
    >
      <header className="site-admin-dev-drawer__header">
        <h3>Debug</h3>
        <button
          type="button"
          className="site-admin-dev-drawer__close"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close drawer"
        >
          ×
        </button>
      </header>
      <div className="site-admin-dev-drawer__body">
        <ResponsePane />
      </div>
    </aside>
  );
}
