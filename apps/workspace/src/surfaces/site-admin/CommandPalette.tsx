import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { JSX } from "react";
import { Search } from "lucide-react";
import { useSiteAdmin } from "./state";
import { stripTrailingSlash } from "./utils";
import type { SiteAdminTab } from "./types";
import { runUpdateCheckSafely } from "../../lib/updater";

// Virtual-scroll constants. The palette never grows past a few hundred
// items in practice, but a blog with 500+ posts adds a row per post and
// we don't want 1000+ <li>s rebuilt on every keystroke. We render a
// window of `OVERSCAN` rows above and below the viewport so scrolling
// + keyboard nav don't have to wait on render.
const ROW_HEIGHT = 36;
const OVERSCAN = 8;
const VIRTUALIZE_THRESHOLD = 60;

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  keywords: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  activeTab: SiteAdminTab;
  onSelectTab: (tab: SiteAdminTab) => void;
  onOpenPost: (slug: string) => void;
  onOpenPage: (slug: string) => void;
  onNewPost: () => void;
  onNewPage: () => void;
}

/** ⌘K command palette — keyboard-first navigation across the site-admin
 * surface. Commands are built inline from current Provider state so they
 * stay in sync with sign-in status, drawer visibility, etc. */
export function CommandPalette({
  open,
  onClose,
  activeTab,
  onSelectTab,
  onOpenPost,
  onOpenPage,
  onNewPost,
  onNewPage,
}: CommandPaletteProps) {
  const {
    connection,
    drawerOpen,
    toggleDrawer,
    signInWithBrowser,
    clearAuth,
    saveConnectionLocally,
    postsIndex,
    pagesIndex,
    activeProfileId,
    profiles,
    switchProfile,
  } = useSiteAdmin();

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const dismiss = useCallback(() => {
    setQuery("");
    setCursor(0);
    onClose();
  }, [onClose]);

  const run = useCallback(
    (action: () => void) => {
      action();
      dismiss();
    },
    [dismiss],
  );

  const commands = useMemo<CommandItem[]>(() => {
    const trimmedBase = stripTrailingSlash(connection.baseUrl || "");
    const items: CommandItem[] = [];

    // Creation shortcuts — first so they stay near the top for fast access.
    items.push({
      id: "new:post",
      label: "New post",
      hint: activeTab === "posts" ? "⌘N" : "Posts",
      keywords: "new post create blog draft",
      run: onNewPost,
    });
    items.push({
      id: "new:page",
      label: "New page",
      hint: activeTab === "pages" ? "⌘N" : "Pages",
      keywords: "new page create standalone",
      run: onNewPage,
    });

    // Per-entry "Open …" — one row per post/page title, so ⌘K can
    // deep-link straight into the editor. Relies on the panel having
    // published its index (auto-fetched on first ready).
    for (const row of postsIndex) {
      items.push({
        id: `open:post:${row.slug}`,
        label: `Open post · ${row.title}`,
        hint: row.draft ? "draft" : (row.dateText || row.dateIso || "—"),
        keywords: `post ${row.title} ${row.slug} ${row.tags.join(" ")}`,
        run: () => onOpenPost(row.slug),
      });
    }
    for (const row of pagesIndex) {
      items.push({
        id: `open:page:${row.slug}`,
        label: `Open page · ${row.title}`,
        hint: row.draft ? "draft" : (row.updatedIso || "—"),
        keywords: `page ${row.title} ${row.slug}`,
        run: () => onOpenPage(row.slug),
      });
    }

    // Tab switches
    const tabs: Array<{ id: SiteAdminTab; label: string }> = [
      { id: "status", label: "Status" },
      { id: "home", label: "Home" },
      { id: "posts", label: "Posts" },
      { id: "pages", label: "Pages" },
      { id: "navigation", label: "Navigation" },
      { id: "links", label: "Links" },
      { id: "release", label: "Release" },
      { id: "settings", label: "Settings" },
    ];
    for (const tab of tabs) {
      items.push({
        id: `goto:${tab.id}`,
        label: `Go to ${tab.label}`,
        hint: tab.id === activeTab ? "current" : undefined,
        keywords: `goto go to ${tab.label} ${tab.id}`,
        run: () => onSelectTab(tab.id),
      });
    }

    items.push({
      id: "drawer:toggle",
      label: drawerOpen ? "Close debug drawer" : "Open debug drawer",
      hint: "⌘\\",
      keywords: "debug drawer toggle response dev",
      run: toggleDrawer,
    });

    if (connection.authToken) {
      items.push({
        id: "auth:clear",
        label: "Sign out (clear app token)",
        keywords: "sign out logout clear auth token",
        run: () => void clearAuth(),
      });
    } else {
      items.push({
        id: "auth:signin",
        label: "Sign in with browser",
        keywords: "sign in login browser github",
        run: () => void signInWithBrowser(),
      });
    }

    items.push({
      id: "connection:save",
      label: "Save connection (base URL) locally",
      keywords: "save connection base url",
      run: saveConnectionLocally,
    });

    if (trimmedBase) {
      items.push({
        id: "open:site-admin",
        label: "Open /site-admin in browser",
        hint: trimmedBase,
        keywords: "open site admin browser",
        run: () => {
          window.open(`${trimmedBase}/site-admin`, "_blank", "noreferrer");
        },
      });
      items.push({
        id: "open:site-admin-login",
        label: "Open /site-admin/login in browser",
        hint: trimmedBase,
        keywords: "open site admin login browser",
        run: () => {
          window.open(`${trimmedBase}/site-admin/login`, "_blank", "noreferrer");
        },
      });
    }

    // Browser shortcuts to the public sites + the GitHub Actions tab.
    // These are stable URLs the operator hits constantly during a
    // release; routing them through the palette saves the "where did I
    // pin that tab" flow when the workspace is full-screen.
    items.push({
      id: "open:public:production",
      label: "Open jinkunchen.com (production)",
      hint: "browser",
      keywords: "open production site browser jinkunchen public",
      run: () => {
        window.open("https://jinkunchen.com/", "_blank", "noreferrer");
      },
    });
    items.push({
      id: "open:public:staging",
      label: "Open staging.jinkunchen.com",
      hint: "browser",
      keywords: "open staging site browser jinkunchen",
      run: () => {
        window.open("https://staging.jinkunchen.com/", "_blank", "noreferrer");
      },
    });
    items.push({
      id: "open:gh:actions",
      label: "Open GitHub Actions",
      hint: "browser",
      keywords: "open github actions ci runs deploy workflow",
      run: () => {
        window.open(
          "https://github.com/Jinnkunn/jinnkunn.com/actions",
          "_blank",
          "noreferrer",
        );
      },
    });

    // Profile switcher — one row per inactive profile so the operator
    // can flip from staging↔production from anywhere without finding
    // the connection pill. We skip the row for the currently-active
    // profile (it'd be a no-op).
    for (const profile of profiles) {
      if (profile.id === activeProfileId) continue;
      items.push({
        id: `profile:switch:${profile.id}`,
        label: `Switch profile · ${profile.label}`,
        hint: profile.baseUrl,
        keywords: `switch profile ${profile.label} ${profile.baseUrl}`,
        run: () => switchProfile(profile.id),
      });
    }

    // Window-level utilities. Reload picks up code edits without
    // restarting the whole Tauri shell — handy after a JS change in
    // dev. Toggle theme cycles the workspace appearance.
    items.push({
      id: "window:reload",
      label: "Reload workspace window",
      hint: "⌘R",
      keywords: "reload window refresh restart",
      run: () => {
        window.location.reload();
      },
    });
    items.push({
      id: "window:cycle-theme",
      label: "Cycle theme (light → dark → system)",
      hint: "appearance",
      keywords: "theme dark light system appearance toggle cycle",
      run: () => {
        // Cycle is owned by the ThemeToggle button — emit the same
        // synthetic event so we don't fork the cycle logic.
        window.dispatchEvent(new CustomEvent("workspace:theme:cycle"));
      },
    });

    items.push({
      id: "app:check-updates",
      label: "Check for updates",
      hint: "auto-update",
      keywords: "update upgrade check version release tauri",
      run: () => {
        // Always notify on the up-to-date branch so the manual click
        // gets feedback even when no update lands. Skip the confirm
        // dialog (`promptBeforeDownload: false`) — the operator
        // explicitly asked, no need to re-ask.
        void runUpdateCheckSafely({
          promptBeforeDownload: false,
          notifyOnUpToDate: true,
        });
      },
    });

    return items;
  }, [
    activeProfileId,
    activeTab,
    clearAuth,
    connection.authToken,
    connection.baseUrl,
    drawerOpen,
    onNewPage,
    onNewPost,
    onOpenPage,
    onOpenPost,
    onSelectTab,
    pagesIndex,
    postsIndex,
    profiles,
    saveConnectionLocally,
    signInWithBrowser,
    switchProfile,
    toggleDrawer,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((cmd) => {
      const haystack = `${cmd.label} ${cmd.keywords}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [commands, query]);

  // Reset cursor when query changes so the top-ranked item is preselected.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCursor(0);
    setScrollTop(0);
  }, [query]);

  // Focus input on open.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  // Track the list's scroll viewport so the windowed renderer can pick the
  // right row range. Layout effect because we read the height immediately
  // after the list mounts, before paint.
  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    setViewportHeight(list.clientHeight);
    const onResize = () => setViewportHeight(list.clientHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, filtered.length]);

  // Keep the active row inside the viewport. We scroll the list element
  // imperatively (no DOM lookup-by-index) so this works for the windowed
  // path where the matching <li> may not be mounted yet.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const rowTop = cursor * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    const visibleTop = list.scrollTop;
    const visibleBottom = visibleTop + list.clientHeight;
    if (rowTop < visibleTop) {
      list.scrollTop = rowTop;
    } else if (rowBottom > visibleBottom) {
      list.scrollTop = rowBottom - list.clientHeight;
    }
  }, [cursor, open, filtered]);

  // Pick the windowed slice we'll actually render. Below the threshold the
  // list is short enough that virtualizing is pure overhead; render in full.
  const useVirtual = filtered.length >= VIRTUALIZE_THRESHOLD;
  const windowStart = useVirtual
    ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    : 0;
  const windowEnd = useVirtual
    ? Math.min(
        filtered.length,
        Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
      )
    : filtered.length;
  const visibleRows = useMemo(
    () => filtered.slice(windowStart, windowEnd),
    [filtered, windowStart, windowEnd],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((c) => Math.min(filtered.length - 1, c + 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const target = filtered[cursor];
        if (target) run(target.run);
      }
    },
    [cursor, dismiss, filtered, run],
  );

  if (!open) return null;

  const activeOptionId = filtered[cursor]
    ? commandOptionId(filtered[cursor].id)
    : undefined;

  return (
    <div
      className="command-palette__backdrop"
      onMouseDown={(event) => {
        // Close on backdrop click but not on clicks inside the panel.
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
      >
        <div className="command-palette__input-wrap">
          <Search
            absoluteStrokeWidth
            aria-hidden="true"
            className="command-palette__icon"
            focusable="false"
            size={14}
            strokeWidth={1.65}
          />
          <input
            ref={inputRef}
            className="command-palette__input"
            placeholder="Type a command…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={activeOptionId}
          />
          <kbd className="command-palette__hint-key">Esc</kbd>
        </div>
        {filtered.length === 0 ? (
          <div className="command-palette__empty">
            <p>No matches.</p>
            <span>{'Try "new post", "status", "sign in", or "routes".'}</span>
          </div>
        ) : (
          <ul
            id="command-palette-list"
            className="command-palette__list"
            role="listbox"
            ref={listRef}
            onScroll={
              useVirtual
                ? (event) => setScrollTop(event.currentTarget.scrollTop)
                : undefined
            }
            style={
              useVirtual
                ? {
                    position: "relative",
                    height: Math.min(
                      filtered.length * ROW_HEIGHT,
                      Math.max(viewportHeight, ROW_HEIGHT * 10),
                    ),
                  }
                : undefined
            }
          >
            {useVirtual ? (
              <li
                aria-hidden="true"
                style={{
                  height: filtered.length * ROW_HEIGHT,
                  pointerEvents: "none",
                }}
              />
            ) : null}
            {visibleRows.map((cmd, sliceIndex) => {
              const index = windowStart + sliceIndex;
              return (
                <Row
                  key={cmd.id}
                  id={commandOptionId(cmd.id)}
                  cmd={cmd}
                  active={index === cursor}
                  onHover={() => setCursor(index)}
                  onSelect={() => run(cmd.run)}
                  virtualOffset={useVirtual ? index * ROW_HEIGHT : undefined}
                />
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function commandOptionId(id: string): string {
  return `command-palette-option-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function Row({
  id,
  cmd,
  active,
  onHover,
  onSelect,
  virtualOffset,
}: {
  id: string;
  cmd: CommandItem;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
  /** When set, the row is absolutely positioned at this top offset (px).
   * Drives the windowed-render path; undefined for the simple short-list path. */
  virtualOffset?: number;
}): JSX.Element {
  const positioned =
    virtualOffset !== undefined
      ? {
          position: "absolute" as const,
          top: virtualOffset,
          left: 0,
          right: 0,
          height: ROW_HEIGHT,
        }
      : undefined;
  return (
    <li
      id={id}
      className="command-palette__row"
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onClick={onSelect}
      style={positioned}
    >
      <span className="command-palette__label">{cmd.label}</span>
      {cmd.hint && <span className="command-palette__hint">{cmd.hint}</span>}
    </li>
  );
}
