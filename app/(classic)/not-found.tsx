import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-404 super-content">
      <div className="page-404__inner">
        <div className="page-404__code">404</div>
        <h1 className="page-404__title">Page not found</h1>
        <p className="page-404__desc">
          The link may be outdated, or the page may have moved in Notion.
        </p>

        <div className="page-404__actions">
          <Link href="/" className="page-404__btn page-404__btn--primary">
            Home
          </Link>
          <Link
            href="/publications"
            className="page-404__btn page-404__btn--ghost"
          >
            Publications
          </Link>
          <Link href="/blog" className="page-404__btn page-404__btn--ghost">
            Blog
          </Link>
        </div>
      </div>
    </main>
  );
}

