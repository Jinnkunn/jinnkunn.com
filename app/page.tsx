import RawHtml from "@/components/raw-html";
import { loadRawMainHtml } from "@/lib/load-raw-main";

export default async function Home() {
  const html = await loadRawMainHtml("index");
  return <RawHtml html={html} />;
}
