import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { JSX } from "react";
import { useSiteAdmin } from "./state";
import { stripTrailingSlash } from "./utils";
import type { SiteAdminTab } from "./types";

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
  } = useSiteAdmin();

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
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
      { id: "publications", label: "Publications" },
      { id: "news", label: "News" },
      { id: "teaching", label: "Teaching" },
      { id: "works", label: "Works" },
      { id: "config", label: "Settings & Navigation" },
      { id: "routes", label: "Routes" },
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

    return items;
  }, [
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
    saveConnectionLocally,
    signInWithBrowser,
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
  }, [query]);

  // Focus input on open.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  // Scroll active row into view as cursor moves.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const activeEl = list.children[cursor] as HTMLElement | undefined;
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [cursor, open, filtered]);

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
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            aria-hidden="true"
            className="command-palette__icon"
          >
            <circle
              cx="7"
              cy="7"
              r="4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M10.5 10.5L14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            ref={inputRef}
            className="command-palette__input"
            placeholder="Type a command…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="command-palette__hint-key">Esc</kbd>
        </div>
        {filtered.length === 0 ? (
          <p className="command-palette__empty">No matches.</p>
        ) : (
          <ul
            className="command-palette__list"
            role="listbox"
            ref={listRef}
          >
            {filtered.map((cmd, index) => (
              <Row
                key={cmd.id}
                cmd={cmd}
                active={index === cursor}
                onHover={() => setCursor(index)}
                onSelect={() => run(cmd.run)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({
  cmd,
  active,
  onHover,
  onSelect,
}: {
  cmd: CommandItem;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}): JSX.Element {
  return (
    <li
      className="command-palette__row"
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onClick={onSelect}
    >
      <span className="command-palette__label">{cmd.label}</span>
      {cmd.hint && <span className="command-palette__hint">{cmd.hint}</span>}
    </li>
  );
}
