import Link from "next/link";
import SiteNavBehavior from "@/components/site-nav-behavior";

type MenuItem = {
  href: string;
  label: string;
};

const topItems: MenuItem[] = [
  { href: "/", label: "Home" },
  { href: "/news", label: "News" },
  { href: "/publications", label: "Publications" },
  { href: "/works", label: "Works" },
];

const moreItems: MenuItem[] = [
  { href: "/blog", label: "Blog" },
  { href: "/teaching", label: "Teaching" },
  { href: "/bio", label: "BIO" },
  { href: "/notice", label: "Notice" },
];

export default function SiteNav() {
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
      {/* Tiny client-side enhancer: handles open/close, scroll lock, and active link classes. */}
      <SiteNavBehavior />

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
            id="mobile-trigger"
            type="button"
            className="super-navbar__button super-navbar__menu-open"
            aria-label="Menu"
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
          style={{
            display: "none",
            transform:
              "translateX(calc(-178px + (var(--navbar-list-width-single-column) / 2)))",
            ["--radix-navigation-menu-viewport-width" as never]:
              "320px" as never,
            ["--radix-navigation-menu-viewport-height" as never]:
              "208px" as never,
          }}
        >
          <div
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
        <div className="super-navbar__menu">
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
        </div>
      </div>
    </nav>
  );
}
