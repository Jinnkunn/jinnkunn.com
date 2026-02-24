import JsonLdScript from "@/components/seo/json-ld-script";
import RawHtml from "@/components/raw-html";
import { loadRawMainHtml } from "@/lib/load-raw-main";
import { buildHomeStructuredData } from "@/lib/seo/structured-data";
import { getSiteConfig } from "@/lib/site-config";

export default async function Home() {
  const html = await loadRawMainHtml("index");
  const cfg = getSiteConfig();
  const jsonLd = buildHomeStructuredData(cfg);
  return (
    <>
      <JsonLdScript id="ld-home" data={jsonLd} />
      <RawHtml html={html} />
    </>
  );
}
