import Link from "next/link";
import { SpecialStatePage } from "@/components/special-state-page";

export default function NotFound() {
  return (
    <SpecialStatePage
      badge="404"
      title="Page not found"
      description="The link may be outdated, or the page may have moved."
      actions={
        <>
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
        </>
      }
    />
  );
}
