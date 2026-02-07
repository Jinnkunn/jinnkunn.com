import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

import SiteFooter from "@/components/site-footer";
import SiteNav from "@/components/site-nav";

export const metadata: Metadata = {
  title: "Jinkun Chen",
  description:
    "I am Jinkun Chen (he/him/his), a Ph.D. student (Post-Bachelor’s, fully funded) studying Computer Science at Dalhousie University under the supervision of Dr. Vlado Keselj.",
  icons: [{ rel: "icon", url: "/assets/favicon.png" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr" className="theme-light">
      <head>
        {/* Preload the home LCP image. This is safe across routes and improves first paint for `/`. */}
        <link rel="preload" as="image" href="/assets/profile.png" fetchPriority="high" />

        {/* Preload the primary fonts used above-the-fold. */}
        <link
          rel="preload"
          as="font"
          href="/fonts/noto-sans-v27-regular.woff2"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          as="font"
          href="/fonts/noto-sans-v27-600.woff2"
          type="font/woff2"
          crossOrigin="anonymous"
        />

        {/* Super/Notion CSS (downloaded from the original site) */}
        <link rel="stylesheet" href="/styles/super-inline.css" />
        <link rel="stylesheet" href="/styles/static.css" />
        <link rel="stylesheet" href="/styles/notion.css" />
        <link rel="stylesheet" href="/styles/super.css" />
        {/* KaTeX styles removed from critical path (next-chunk.css). Add it back only if you render KaTeX. */}
      </head>
      <body>
        <div className="super-root">
          {/* Match Super's structure: a sticky "notion-navbar" wrapper containing the super navbar. */}
          <div className="notion-navbar">
            <SiteNav />
          </div>
          <div className="super-content-wrapper">{children}</div>
          <SiteFooter />
        </div>

        {/* Cloudflare email decode (used by original HTML for obfuscated email addresses) */}
        <Script
          data-cfasync="false"
          src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
