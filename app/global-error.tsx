"use client";

import Link from "next/link";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" dir="ltr" className="theme-light">
      <body>
        <main className="page-404 super-content">
          <div className="page-404__inner">
            <div className="page-404__code">Error</div>
            <h1 className="page-404__title">Something went wrong</h1>
            <p className="page-404__desc">
              Please try again. If this keeps happening, go back home and
              navigate from there.
            </p>

            <div className="page-404__actions">
              <button
                type="button"
                className="page-404__btn page-404__btn--primary"
                onClick={() => reset()}
              >
                Try again
              </button>
              <Link href="/" className="page-404__btn page-404__btn--ghost">
                Home
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}

