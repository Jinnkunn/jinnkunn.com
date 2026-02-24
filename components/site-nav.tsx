import Link from "next/link";
import SiteNavEnhancers from "@/components/site-nav-enhancers";
import { getSiteConfig } from "@/lib/site-config";

export default function SiteNav() {
  const cfg = getSiteConfig();
  const topItems = cfg.nav.top;
  const moreItems = cfg.nav.more;

  return (
    <nav
      id="site-nav"
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
      {/* Load nav/search behavior runtime on the client after initial paint. */}
      <SiteNavEnhancers />

      <div className="super-navbar__content">
        <Link href="/" className="notion-link super-navbar__logo">
          <span className="super-navbar__logo-text" style={{ fontSize: 16 }}>
            {cfg.siteName}
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
                <Link href={it.href} className="notion-link super-navbar__item">
                  {it.label}
                </Link>
              </li>
            ))}

            <li>
              <button
                id="more-trigger"
                type="button"
                className="super-navbar__list"
                aria-expanded="false"
                aria-haspopup="menu"
                aria-controls="more-menu"
                data-state="closed"
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
          <button
            id="search-trigger"
            type="button"
            className="super-navbar__button super-navbar__search"
            aria-label="Search"
            aria-haspopup="dialog"
            aria-expanded="false"
            aria-controls="notion-search"
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
              className="lucide lucide-search"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </button>

          <button
            id="mobile-trigger"
            type="button"
            className="super-navbar__button super-navbar__menu-open"
            aria-label="Menu"
            aria-haspopup="dialog"
            aria-expanded="false"
            aria-controls="mobile-menu"
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
        <div
          id="more-menu"
          data-state="closed"
          data-orientation="horizontal"
          className="super-navbar__viewport single-column"
          role="menu"
          aria-labelledby="more-trigger"
          style={{
            display: "none",
            transform:
              "translateX(calc(-178px + (var(--navbar-list-width-single-column) / 2)))",
            ["--radix-navigation-menu-viewport-width" as never]:
              "320px" as never,
          }}
        >
          <div
            data-orientation="horizontal"
            className="super-navbar__list-content single-column"
            dir="ltr"
          >
            <ul className="super-navbar__list-content-column" role="none">
              {moreItems.map((it) => (
                <li key={it.href} role="none">
                  <Link
                    href={it.href}
                    role="menuitem"
                    className="notion-link super-navbar__list-item"
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
      </div>

      <div id="mobile-menu" className="super-navbar__menu-wrapper" hidden>
        <div
          className="super-navbar__menu"
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
        >
          <button
            id="mobile-backdrop"
            type="button"
            className="super-navbar__menu-backdrop"
            aria-label="Close menu"
            tabIndex={-1}
          />

          <div className="super-navbar__menu-surface">
            <div className="super-navigation-menu__items-wrapper">
              <div className="super-navigation-menu__items">
                {[...topItems, ...moreItems].map((it) => (
                  <Link
                    key={it.href}
                    href={it.href}
                    className="notion-link super-navbar__item"
                  >
                    {it.label}
                  </Link>
                ))}
              </div>
            </div>

            {/* Mobile: close action belongs after the nav items (less empty space up top). */}
            <div className="super-navbar__menu-footer">
              <button
                id="mobile-close"
                type="button"
                className="super-navbar__menu-close"
                aria-label="Close menu"
              >
                <span className="sr-only">Close</span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
