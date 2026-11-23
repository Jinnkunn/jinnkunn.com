import { webManifestResponse } from "@/lib/seo/web-manifest";

export const dynamic = "force-static";

export function GET() {
  // Minimal PWA manifest to satisfy implicit browser requests and prevent
  // falling through to the catch-all route (which can log NoFallbackError in dev).
  return webManifestResponse();
}
