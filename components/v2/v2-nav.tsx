import Link from "next/link";
import styles from "./v2-nav.module.css";
import V2NavBehavior from "./v2-nav-behavior";

const top = [
  { href: "/v2", label: "Home" },
  { href: "/v2/news", label: "News" },
  { href: "/v2/publications", label: "Publications" },
  { href: "/v2/works", label: "Works" },
];

const more = [
  { href: "/v2/blog", label: "Blog" },
  { href: "/v2/teaching", label: "Teaching" },
  { href: "/v2/bio", label: "Bio" },
];

export default function V2Nav() {
  return (
    <header className={styles.wrap}>
      <V2NavBehavior />
      <div className={styles.inner}>
        <Link href="/v2" className={styles.brand}>
          <span className={styles.brandMark} aria-hidden>
            JC
          </span>
          <span className={styles.brandText}>Jinkun Chen</span>
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          {top.map((it) => (
            <Link key={it.href} href={it.href} className={styles.link}>
              {it.label}
            </Link>
          ))}

          <button
            id="v2-more-trigger"
            type="button"
            className={styles.moreBtn}
            aria-expanded="false"
            aria-controls="v2-more"
          >
            More
            <span className={styles.chev} aria-hidden>
              ▾
            </span>
          </button>
        </nav>

        <button
          id="v2-menu-trigger"
          type="button"
          className={styles.menuBtn}
          aria-label="Menu"
          aria-expanded="false"
          aria-controls="v2-menu"
        >
          Menu
        </button>
      </div>

      <div id="v2-more" className={styles.more} hidden>
        <div className={styles.moreInner}>
          {more.map((it) => (
            <Link key={it.href} href={it.href} className={styles.moreLink}>
              {it.label}
            </Link>
          ))}
        </div>
      </div>

      <div id="v2-menu" className={styles.drawer} hidden>
        <div className={styles.drawerTop}>
          <div className={styles.drawerTitle}>Menu</div>
          <button
            id="v2-menu-close"
            type="button"
            className={styles.closeBtn}
          >
            Close
          </button>
        </div>

        <div className={styles.drawerList}>
          {[...top, ...more].map((it) => (
            <Link key={it.href} href={it.href} className={styles.drawerLink}>
              {it.label}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}

