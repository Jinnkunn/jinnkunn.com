import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jinkun Chen",
  description:
    "Jinkun Chen (he/him/his) — Ph.D. student studying Computer Science at Dalhousie University.",
  icons: [{ rel: "icon", url: "/assets/favicon.png" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr" className="theme-light">
      <body>{children}</body>
    </html>
  );
}
