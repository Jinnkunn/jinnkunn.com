export const dynamic = "force-static";

export function GET(_req: Request) {
  // Minimal PWA manifest to satisfy implicit browser requests and prevent
  // falling through to the catch-all route (which can log NoFallbackError in dev).
  const body = JSON.stringify(
    {
      name: "Jinkun Chen",
      short_name: "Jinkun",
      icons: [
        {
          src: "/assets/favicon.png",
          sizes: "512x512",
          type: "image/png",
        },
      ],
      start_url: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#ffffff",
    },
    null,
    2,
  );

  return new Response(body, {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=604800",
    },
  });
}

