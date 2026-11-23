import { webManifestResponse } from "@/lib/seo/web-manifest";

export const dynamic = "force-static";

export function GET() {
  // Some UAs request /manifest.json. Serve the same document as /site.webmanifest
  // instead of redirecting (see webManifestResponse for why a redirect broke).
  return webManifestResponse();
}
