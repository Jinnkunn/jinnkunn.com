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
            onClick={() => reset()}
          >
            Try again
          </Button>
          <Button href="/" variant="ghost">
            Home
          </Button>
        </>
      }
    />
  );
}
