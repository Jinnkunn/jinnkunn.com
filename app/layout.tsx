import type { Metadata, Viewport } from "next";
import Script from "next/script";
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
    <html lang={cfg.lang || "en"} dir="ltr" data-theme="light" className="theme-light">
      <body>
        <Script id="design-theme-init" strategy="beforeInteractive">
          {getDesignThemeInitScript()}
        </Script>
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
