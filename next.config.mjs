import path from "node:path";
import bundleAnalyzer from "@next/bundle-analyzer";

// Gate the analyzer behind `ANALYZE=1 npm run build` so a normal build
// stays fast and without HTML-report side effects. The analyzer emits
// `.next/analyze/*.html` which CI artifacts can pick up.
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "1" || process.env.ANALYZE === "true",
  openAnalyzer: false,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Avoid Next.js incorrectly inferring the repo root due to other lockfiles on the machine.
  outputFileTracingRoot: path.resolve("."),
  // Don't advertise the runtime framework via a response header.
  poweredByHeader: false,
  // Worker bundles only need the generated manifest JSON; MDX + structured
  // JSON under `content/{posts,pages,*.json}` are imported directly.
  outputFileTracingIncludes: {
    "/**": ["content/generated/**"],
  },
  turbopack: {
    root: path.resolve("."),
  },

  images: {
    formats: ["image/avif", "image/webp"],
  },

  async headers() {
    // Improve caching for static assets under /public.
    // Use a conservative max-age since these files are not content-hashed.
    const assetCache = "public, max-age=604800, stale-while-revalidate=86400";
    // Content-hashed Next build assets under `/_next/static/**` can be held
    // forever; the hash in the URL is the cache key.
    const immutableCache = "public, max-age=31536000, immutable";
    return [
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: immutableCache }],
      },
      {
        source: "/assets/:path*",
        headers: [{ key: "Cache-Control", value: assetCache }],
      },
      {
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: assetCache }],
      },
      {
        source: "/styles/:path*",
        headers: [{ key: "Cache-Control", value: assetCache }],
      },
      {
        source: "/web_image/:path*",
        headers: [{ key: "Cache-Control", value: assetCache }],
      },
      {
        source: "/cdn-cgi/scripts/:path*",
        headers: [{ key: "Cache-Control", value: assetCache }],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
