import "./site-admin.css";

import SiteAdminProviders from "@/components/site-admin-providers";

export default function SiteAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SiteAdminProviders>{children}</SiteAdminProviders>;
}
