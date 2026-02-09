import RouteExplorer from "@/components/route-explorer";
import SiteAdminBreadcrumbs from "@/components/site-admin-breadcrumbs";
import { getRoutesManifest } from "@/lib/routes-manifest";

export const dynamic = "force-dynamic";
// Admin pages should not be cached publicly.
export const revalidate = 0;

export default function RoutesPage() {
  const items = getRoutesManifest();
  return (
    <main className="super-content page__routes">
      <SiteAdminBreadcrumbs
        crumbs={[
          { href: "/", label: "Home" },
          { href: "/site-admin", label: "Site Admin" },
          { href: "/site-admin/routes", label: "Routes" },
        ]}
      />
      <RouteExplorer items={items} />
    </main>
  );
}
