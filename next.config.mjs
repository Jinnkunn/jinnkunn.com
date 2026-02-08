import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Avoid Next.js incorrectly inferring the repo root due to other lockfiles on the machine.
  outputFileTracingRoot: path.resolve("."),
  // The site loads Notion-rendered HTML from the filesystem at runtime
  // (`content/generated/raw/**`). These files are created during `prebuild`,
  // so we must explicitly include them in Next's output file tracing, otherwise
  // Vercel deployments won't contain the freshly-synced content.
  outputFileTracingIncludes: {
    "/**": ["content/generated/**", "content/raw/**"],
  },
  turbopack: {
    root: path.resolve("."),
  },

  async headers() {
    // Improve caching for static assets under /public.
    // Use a conservative max-age since these files are not content-hashed.
    const assetCache = "public, max-age=604800, stale-while-revalidate=86400";
    return [
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

export default nextConfig;
