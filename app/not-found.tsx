import Link from "next/link";
import { SpecialStatePage } from "@/components/special-state-page";

export default function NotFound() {
  return (
    <SpecialStatePage
      badge="404"
      layout="inline"
      title="This page could not be found."
      description=""
      actions={
        <Link href="/" className="page-404__btn page-404__btn--primary">
          Back Home
        </Link>
      }
    />
  );
}
