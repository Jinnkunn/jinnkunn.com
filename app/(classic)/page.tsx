import { HomeView } from "@/components/home/home-view";
import JsonLdScript from "@/components/seo/json-ld-script";
import { buildHomeStructuredData } from "@/lib/seo/structured-data";
import { getSiteConfig } from "@/lib/site-config";
import { loadSiteAdminHomeData } from "@/lib/server/site-admin-home-service";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cfg = getSiteConfig();
  const { data } = await loadSiteAdminHomeData();
  const jsonLd = buildHomeStructuredData(cfg);
  return (
    <>
      <JsonLdScript id="ld-home" data={jsonLd} />
      <HomeView data={data} />
    </>
  );
}
