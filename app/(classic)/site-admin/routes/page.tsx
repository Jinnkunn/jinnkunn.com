import RouteExplorer from "@/components/route-explorer";
import { getRoutesManifest } from "@/lib/routes-manifest";

export const dynamic = "force-dynamic";
// Admin pages should not be cached publicly.
export const revalidate = 0;

export default function RoutesPage() {
  const items = getRoutesManifest();
  return (
    <main className="super-content page__routes">
      <RouteExplorer items={items} />
    </main>
  );
}
