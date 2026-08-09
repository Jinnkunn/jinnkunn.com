import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { designViewportThemeColors } from "@/lib/design-system/tokens";
import { getDesignThemeInitScript } from "@/lib/design-system/theme";
import {
  buildGoogleAnalyticsInitScript,
  normalizeGoogleAnalyticsId,
} from "@/lib/shared/google-analytics";
import { getSiteConfig } from "@/lib/site-config";
import { buildRootMetadata } from "@/lib/seo/metadata";
import Providers from "@/components/providers";
import "./design-system.css";
import "./globals.css";
import "./state-pages.css";

export async function generateMetadata(): Promise<Metadata> {
  return buildRootMetadata(getSiteConfig());
}

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [...designViewportThemeColors],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cfg = getSiteConfig();
  const gaId = normalizeGoogleAnalyticsId(cfg.integrations?.googleAnalyticsId) || "";
  const gaInitScript = buildGoogleAnalyticsInitScript(gaId);
  return (
    <html
      lang={cfg.lang || "en"}
      dir="ltr"
      data-theme="light"
      className={`theme-light ${GeistSans.variable} ${GeistMono.variable}`}
      // The theme-init script below rewrites `data-theme` / `theme-*` on <html>
      // before React hydrates, so the server markup and the DOM legitimately
      // disagree for dark visitors. Suppress the resulting hydration warning.
      suppressHydrationWarning
    >
      <body>
        {/* Theme init MUST be a plain parser-blocking inline <script>, not
         * next/script. `strategy="beforeInteractive"` compiles into the
         * `(self.__next_s=...).push(...)` queue that the client runtime drains
         * after first paint, so dark-mode visitors would flash a full white
         * screen on every cold load (there is no `prefers-color-scheme`
         * fallback anywhere in the CSS). Inline here, it runs synchronously as
         * the browser parses <body>, before any paint. */}
        <script
          id="design-theme-init"
          dangerouslySetInnerHTML={{ __html: getDesignThemeInitScript() }}
        />
        <Providers>{children}</Providers>
        {gaId ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
                gaId,
              )}`}
              strategy="afterInteractive"
            />
            <Script id="gtag-init" strategy="afterInteractive">
              {gaInitScript}
            </Script>
          </>
        ) : null}
      </body>
    </html>
  );
}
