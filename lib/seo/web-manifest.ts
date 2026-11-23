import { designThemeMeta } from "../design-system/tokens.ts";

/** The PWA manifest, served at both `/site.webmanifest` and `/manifest.json`.
 *
 * `/manifest.json` used to 307 to `/site.webmanifest` with an absolute URL built
 * from `req.url`. Both handlers are `force-static`, so Next prerenders them at
 * build time, when `req.url` is `http://localhost:3000/...` — production shipped
 * a redirect to localhost. Serving the same document from both paths needs no
 * request URL at all. */
export function webManifestResponse(): Response {
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
        {
          src: "/apple-touch-icon.png",
          sizes: "180x180",
          type: "image/png",
        },
      ],
      start_url: "/",
      display: "standalone",
      background_color: designThemeMeta.light.backgroundColor,
      theme_color: designThemeMeta.light.themeColor,
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
