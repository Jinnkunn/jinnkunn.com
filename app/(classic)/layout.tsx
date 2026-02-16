import Script from "next/script";

import SiteFooter from "@/components/site-footer";
import SiteNav from "@/components/site-nav";
import NotionBlockBehavior from "@/components/notion-block-behavior";
import ViewportCssVars from "@/components/viewport-css-vars";
import FestivalOverlay from "@/components/festival-overlay";
import FireworksClickEffect from "@/components/fireworks-click-effect";

// Route-scoped global CSS for the classic (1:1) version.
// Next.js v16 no longer reliably applies `head.tsx` link tags in route groups,
// so we import a tiny CSS shim that @imports the public Super/Notion styles.
import "./classic.css";
import "./search.css";
import "./toc.css";
import "./lightbox.css";
import "./publications.css";
import "./page-overrides.css";
import "./notion-blocks.css";
import "./navigation.css";
import "./runtime-polish.css";
import "./festival.css";
import "./fireworks.css";

export default function ClassicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <div className="super-root">
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteNav />
        <FestivalOverlay />
        <FireworksClickEffect />
        {/* Align a few CSS breakouts (breadcrumbs) with the navbar even when scrollbars are present. */}
        <ViewportCssVars />
        {/* Lightweight JS to restore Notion interactions that otherwise require client hydration. */}
        <NotionBlockBehavior />
        <div id="main-content" className="super-content-wrapper">
          {children}
        </div>
        <SiteFooter />
      </div>

      {/* Cloudflare email decode (used by original HTML for obfuscated email addresses) */}
      <Script
        data-cfasync="false"
        src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"
        strategy="afterInteractive"
      />
    </>
  );
}
