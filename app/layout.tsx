import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/site-config";
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
  return (
    <html lang={cfg.lang || "en"} dir="ltr" className="theme-light">
      <body>{children}</body>
    </html>
  );
}
