import type { Metadata } from "next";

import { SpecialStatePage } from "@/components/special-state-page";
import { Button } from "@/components/ui/button";
import { getSiteConfig } from "@/lib/site-config";

// This module is what Next.js compiles into the `/_not-found` entry, and that
// entry is what actually serves every unmatched URL: the classic catch-all
// (`app/(classic)/[...slug]`) sets `dynamicParams = false`, so an unknown slug
// is rejected by the router before the segment renders and never reaches
// `app/(classic)/not-found.tsx`. That also means this page renders under the
// root layout only — the classic shell (nav, footer, Super/Notion CSS) is not
// available here, so the exits have to live in the page body itself.

export const metadata: Metadata = {
  // Root metadata supplies the `%s | Jinkun Chen` template; previously the 404
  // fell through to the bare site title with no indication of the error.
  title: "Page not found",
  description: "That page does not exist. Jump back to the home page or another section.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  const cfg = getSiteConfig();
  // Deliberately the primary nav only (plus /sitemap below) rather than
  // `nav.top + nav.more`: a 404 that links onward to another 404 is worse than
  // a shorter list, and the sitemap covers everything the shortlist omits.
  const sections = cfg.nav.top.filter((item) => item.href !== "/");

  return (
    <SpecialStatePage
      badge="404"
      title="Page not found"
      description="This page doesn’t exist, or it moved. Head back home, jump straight to a section, or browse the full sitemap."
      actions={
        <>
          <Button href="/">Back home</Button>
          {sections.map((item) => (
            <Button key={item.href} href={item.href} variant="ghost">
              {item.label}
            </Button>
          ))}
          <Button href="/sitemap" variant="ghost">
            Sitemap
          </Button>
        </>
      }
    />
  );
}
