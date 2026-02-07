"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type MenuItem = {
  href: string;
  label: string;
};

const moreItems: MenuItem[] = [
  // Match the original site's "More" dropdown.
  { href: "/blog", label: "Blog" },
  { href: "/teaching", label: "Teaching" },
  { href: "/bio", label: "BIO" },
  { href: "/notice", label: "Notice" },
];

export default function SiteNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  const topItems = useMemo<MenuItem[]>(
    () => [
      { href: "/", label: "Home" },
      { href: "/news", label: "News" },
      { href: "/publications", label: "Publications" },
      { href: "/works", label: "Works" },
    ],
    []
  );

  const [moreOpen, setMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const moreListContentRef = useRef<HTMLDivElement | null>(null);
  const [moreViewportHeight, setMoreViewportHeight] = useState<number>(208);
  const [moreViewportWidth, setMoreViewportWidth] = useState<number>(320);

  const closeAll = () => {
    setMoreOpen(false);
    setMenuOpen(false);
  };

  useEffect(() => {
    // close popovers on navigation
    closeAll();
  }, [pathname]);

  useEffect(() => {
    // Close menus on outside click/tap + ESC.
    if (!moreOpen && !menuOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const nav = navRef.current;
      if (!nav) return;
      if (e.target instanceof Node && nav.contains(e.target)) return;
      closeAll();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeAll();
      // return focus to the most relevant trigger
      if (menuOpen) menuButtonRef.current?.focus();
      else if (moreOpen) moreButtonRef.current?.focus();
    };

    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen, menuOpen]);

  useEffect(() => {
    // Mobile UX: prevent background scroll when the hamburger menu is open.
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!moreOpen) return;

    const update = () => {
      const el = moreListContentRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0) setMoreViewportWidth(Math.ceil(r.width));
      if (r.height > 0) setMoreViewportHeight(Math.ceil(r.height));
    };

    const raf = requestAnimationFrame(update);
    window.addEventListener("resize", update, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
    };
  }, [moreOpen]);

  return (
    <nav
      ref={navRef}
      aria-label="Main"
      data-orientation="horizontal"
      dir="ltr"
      className="super-navbar simple"
      style={{
        position: "relative",
        boxShadow: "var(--navbar-shadow)",
        WebkitBoxShadow: "var(--navbar-shadow)",
      }}
    >
      <div className="super-navbar__content">
        <Link href="/" className="notion-link super-navbar__logo">
          <span className="super-navbar__logo-text" style={{ fontSize: 16 }}>
            Jinkun Chen.
          </span>
        </Link>

        <div style={{ position: "relative" }}>
          <ul
            data-orientation="horizontal"
            className="super-navbar__item-list"
            dir="ltr"
          >
            {topItems.map((it) => (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={`notion-link super-navbar__item${
                    pathname === it.href ? " active" : ""
                  }`}
                >
                  {it.label}
                </Link>
              </li>
            ))}

            <li>
              <button
                ref={moreButtonRef}
                type="button"
                className="super-navbar__list"
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                aria-controls="more-menu"
                data-state={moreOpen ? "open" : "closed"}
                onClick={() => setMoreOpen((v) => !v)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="lucide lucide-chevron-down"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
                More
              </button>
            </li>
          </ul>
        </div>

        <div className="super-navbar__actions">
          <div className="super-navbar__button super-navbar__search" aria-hidden>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-search"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>

          <button
            ref={menuButtonRef}
            type="button"
            className="super-navbar__button super-navbar__menu-open"
            aria-label="Menu"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-menu"
            >
              <line x1="4" x2="20" y1="12" y2="12" />
              <line x1="4" x2="20" y1="6" y2="6" />
              <line x1="4" x2="20" y1="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="super-navbar__viewport-wrapper">
        {moreOpen ? (
          <div
            id="more-menu"
            data-state="open"
            data-orientation="horizontal"
            className="super-navbar__viewport single-column"
            style={{
              // Mirror Super/Radix's positioning behavior for this specific site.
              transform:
                "translateX(calc(-178px + (var(--navbar-list-width-single-column) / 2)))",
              ["--radix-navigation-menu-viewport-width" as never]:
                `${moreViewportWidth}px` as never,
              ["--radix-navigation-menu-viewport-height" as never]:
                `${moreViewportHeight}px` as never,
            }}
          >
            <div
              ref={moreListContentRef}
              data-orientation="horizontal"
              className="super-navbar__list-content single-column"
              dir="ltr"
            >
              <ul className="super-navbar__list-content-column" role="menu">
                {moreItems.map((it) => (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      role="menuitem"
                      className="notion-link super-navbar__list-item"
                      onClick={() => setMoreOpen(false)}
                    >
                      <div className="super-navbar__list-item-content">
                        <div className="super-navbar__list-item-heading">
                          {it.label}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>

      {menuOpen ? (
        <div id="mobile-menu" className="super-navbar__menu-wrapper enter-done">
          <div className="super-navbar__menu">
            <div className="super-navigation-menu__items-wrapper">
              <div className="super-navigation-menu__items">
                {[...topItems, ...moreItems].map((it) => (
                  <Link
                    key={it.href}
                    href={it.href}
                    className={`notion-link super-navbar__item${
                      pathname === it.href ? " active" : ""
                    }`}
                    onClick={() => setMenuOpen(false)}
                  >
                    {it.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </nav>
  );
}
