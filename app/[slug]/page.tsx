import RawHtml from "@/components/raw-html";
import { loadRawMainHtml } from "@/lib/load-raw-main";
import { notFound } from "next/navigation";

export default async function SlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  try {
    const html = await loadRawMainHtml(slug);
    return <RawHtml html={html} />;
  } catch {
    notFound();
  }
}
