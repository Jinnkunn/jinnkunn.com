"use client";

import { getDesignThemeInitScript } from "@/lib/design-system/theme";
import { SpecialStatePage } from "@/components/special-state-page";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" dir="ltr" data-theme="light" className="theme-light">
      <head>
        <script
          id="design-theme-init-error"
          dangerouslySetInnerHTML={{ __html: getDesignThemeInitScript() }}
        />
      </head>
      <body>
        <SpecialStatePage
          tone="danger"
          badge="Error"
          title="Something went wrong"
          description="Please try again. If this keeps happening, go back home and navigate from there."
          actions={
            <>
              <Button type="button" onClick={() => reset()}>
                Try again
              </Button>
              <Button href="/" variant="ghost">
                Home
              </Button>
            </>
          }
        />
      </body>
    </html>
  );
}
