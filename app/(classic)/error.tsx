"use client";

import { SpecialStatePage } from "@/components/special-state-page";
import { Button } from "@/components/ui/button";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SpecialStatePage
      tone="danger"
      badge="Error"
      title="Something went wrong"
      description="Please try again. If this keeps happening, go back home and navigate from there."
      actions={
        <>
          <Button
            type="button"
            className="page-404__btn page-404__btn--primary"
            onClick={() => reset()}
          >
            Try again
          </Button>
          <Button
            href="/"
            variant="ghost"
            className="page-404__btn page-404__btn--ghost"
          >
            Home
          </Button>
        </>
      }
    />
  );
}
