import { useMemo } from "react";
import {
  ExternalLink,
  FileText,
  Home,
  Menu,
  Newspaper,
  type LucideIcon,
} from "lucide-react";

import { openExternalUrl } from "../../lib/tauri";
import { useSurfaceNav } from "../../shell/surface-nav-context";
import { useSiteAdmin } from "./state";

/**
 * Top-of-StatusPanel hero. Status is the default Site Admin tab, so this is
 * effectively the landing screen — replace the previous "wall of diagnostic
 * fields" first impression with the answers a returning operator usually
 * wants in two seconds: which site am I in, what's it have, and how do I
 * jump into a content area? Detailed release diagnostics still live below
 * in PublishPipelineCard + the Release Health disclosure.
 */
export function SiteOverviewCard() {
  const { connection, environment, pagesIndex, postsIndex, productionReadOnly } =
    useSiteAdmin();
  const { setActiveNavItemId } = useSurfaceNav();

  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);

  const host = useMemo(() => {
    const raw = connection.baseUrl;
    if (!raw) return "";
    try {
      return new URL(raw).hostname || raw;
    } catch {
      return raw;
    }
  }, [connection.baseUrl]);

  const openPublic = () => {
    const target = connection.baseUrl;
    if (!target) return;
    void openExternalUrl(target).catch(() => {
      // Tauri webview blocks the open command in dev preview; the link
      // is harmless and the failure is already user-visible (button is
      // disabled when there is no baseUrl, so an actual prod failure
      // would be an OS-level handler issue).
    });
  };

  const tiles: Array<{
    icon: LucideIcon;
    label: string;
    value: string;
    target: string;
    hint: string;
  }> = [
    {
      icon: FileText,
      label: "Pages",
      value: ready ? String(pagesIndex.length) : "—",
      target: "pages",
      hint: "Open the Pages panel",
    },
    {
      icon: Newspaper,
      label: "Posts",
      value: ready ? String(postsIndex.length) : "—",
      target: "posts",
      hint: "Open the Posts panel",
    },
    {
      icon: Home,
      label: "Home",
      value: "",
      target: "home",
      hint: "Edit the Home page",
    },
    {
      icon: Menu,
      label: "Navigation",
      value: "",
      target: "navigation",
      hint: "Edit site navigation links",
    },
  ];

  return (
    <section className="site-overview" aria-label="Site overview">
      <header className="site-overview__head">
        <div className="site-overview__identity">
          <h2>{host || "Site"}</h2>
          <span
            className="site-overview__env"
            data-kind={environment.kind}
            title={environment.helpText}
          >
            {environment.label}
            {productionReadOnly ? " · Read-only" : ""}
          </span>
        </div>
        <button
          type="button"
          className="btn btn--ghost site-overview__open-public"
          disabled={!connection.baseUrl}
          onClick={openPublic}
          title={connection.baseUrl || "Set a base URL to enable"}
        >
          <ExternalLink
            absoluteStrokeWidth
            aria-hidden="true"
            focusable="false"
            size={12}
            strokeWidth={1.7}
          />
          <span>Open public</span>
        </button>
      </header>
      <div className="site-overview__tiles">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <button
              key={tile.target}
              type="button"
              className="site-overview__tile"
              onClick={() => setActiveNavItemId(tile.target)}
              title={tile.hint}
            >
              <Icon
                absoluteStrokeWidth
                aria-hidden="true"
                focusable="false"
                size={16}
                strokeWidth={1.6}
              />
              {tile.value ? (
                <strong className="site-overview__tile-value">{tile.value}</strong>
              ) : null}
              <span className="site-overview__tile-label">{tile.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
