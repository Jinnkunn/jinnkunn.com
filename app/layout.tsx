import type { Metadata } from "next";
import Script from "next/script";
import { getSiteConfig } from "@/lib/site-config";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const cfg = getSiteConfig();
  const baseTitle = cfg.seo.title || cfg.siteName;
  return {
    title: {
      default: baseTitle,
      template: `%s | ${baseTitle}`,
    },
    description: cfg.seo.description,
    icons: cfg.seo.favicon ? [{ rel: "icon", url: cfg.seo.favicon }] : undefined,
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cfg = getSiteConfig();
  const gaId = cfg.integrations?.googleAnalyticsId?.trim() || "";
  return (
    <html lang={cfg.lang || "en"} dir="ltr" className="theme-light">
      <body>
        {children}
        <SpeedInsights />
        <Analytics />
        {gaId ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
                gaId,
              )}`}
              strategy="afterInteractive"
            />
            <Script id="gtag-init" strategy="afterInteractive">
              {`
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${gaId}', { anonymize_ip: true });
              `.trim()}
            </Script>
          </>
        ) : null}
      </body>
    </html>
  );
}
