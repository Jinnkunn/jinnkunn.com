import type { Metadata } from "next";
import Script from "next/script";
import { getSiteConfig } from "@/lib/site-config";
import { buildRootMetadata } from "@/lib/seo/metadata";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/react";
import Providers from "@/components/providers";
import "./globals.css";
import "./state-pages.css";

export async function generateMetadata(): Promise<Metadata> {
  return buildRootMetadata(getSiteConfig());
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cfg = getSiteConfig();
  const gaId = cfg.integrations?.googleAnalyticsId?.trim() || "";
  const enableVercelRuntimeInsights = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  return (
    <html lang={cfg.lang || "en"} dir="ltr" className="theme-light">
      <body>
        <Providers>{children}</Providers>
        {enableVercelRuntimeInsights ? (
          <>
            <SpeedInsights />
            <Analytics />
          </>
        ) : null}
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
