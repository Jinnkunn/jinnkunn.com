import Script from "next/script";

import SiteFooter from "@/components/site-footer";
import SiteNav from "@/components/site-nav";

// Route-scoped global CSS for the classic (1:1) version.
// Next.js v16 no longer reliably applies `head.tsx` link tags in route groups,
// so we import a tiny CSS shim that @imports the public Super/Notion styles.
import "./classic.css";

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
        {/* Match Super's structure: a sticky "notion-navbar" wrapper containing the super navbar. */}
        <div className="notion-navbar">
          <SiteNav />
        </div>
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
