import RouteExplorer from "@/components/route-explorer";
import { getRoutesManifest } from "@/lib/routes-manifest";

export const dynamic = "force-static";

export default function RoutesPage() {
  const items = getRoutesManifest();
  return (
    <main className="super-content page__routes">
      <RouteExplorer items={items} />
    </main>
  );
}

