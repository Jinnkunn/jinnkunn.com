import homeData from "@/content/home.json";
import { HomeView } from "@/components/home/home-view";
import JsonLdScript from "@/components/seo/json-ld-script";
import { buildHomeStructuredData } from "@/lib/seo/structured-data";
import { getSiteConfig } from "@/lib/site-config";
import { normalizeHomeData } from "@/lib/site-admin/home-normalize";
import type { SiteAdminHomeData } from "@/lib/site-admin/api-types";

export const dynamic = "force-static";

function readData(): SiteAdminHomeData {
  return normalizeHomeData(homeData);
}

export default async function Home() {
  const cfg = getSiteConfig();
  const data = readData();
  const jsonLd = buildHomeStructuredData(cfg);
  return (
    <>
      <JsonLdScript id="ld-home" data={jsonLd} />
      <HomeView data={data} />
    </>
  );
}
