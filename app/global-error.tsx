"use client";

import Link from "next/link";
import { SpecialStatePage } from "@/components/special-state-page";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" dir="ltr" className="theme-light">
      <body>
        <SpecialStatePage
          tone="danger"
          badge="Error"
          title="Something went wrong"
          description="Please try again. If this keeps happening, go back home and navigate from there."
          actions={
            <>
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
            </>
          }
        />
      </body>
    </html>
  );
}
