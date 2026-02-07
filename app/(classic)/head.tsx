export default function Head() {
  return (
    <>
      {/* Preload the home LCP image. This is safe across routes and improves first paint for `/`. */}
      <link rel="preload" as="image" href="/assets/profile.png" fetchPriority="high" />

      {/* Preload the primary fonts used above-the-fold. */}
      <link
        rel="preload"
        as="font"
        href="/fonts/noto-sans-v27-regular.woff2"
        type="font/woff2"
        crossOrigin="anonymous"
      />
      <link
        rel="preload"
        as="font"
        href="/fonts/noto-sans-v27-600.woff2"
        type="font/woff2"
        crossOrigin="anonymous"
      />

      {/* CSS: keep as render-blocking to avoid FOUC, but preload to start downloads earlier. */}
      <link rel="preload" as="style" href="/styles/super-inline.css" fetchPriority="high" />
      <link rel="preload" as="style" href="/styles/notion.css" fetchPriority="high" />
      <link rel="preload" as="style" href="/styles/super-nav.css" fetchPriority="high" />
      <link rel="preload" as="style" href="/styles/static.css" />
      <link rel="preload" as="style" href="/styles/super.css" />

      {/* Super/Notion CSS (downloaded from the original site) */}
      <link rel="stylesheet" href="/styles/super-inline.css" />
      <link rel="stylesheet" href="/styles/static.css" />
      <link rel="stylesheet" href="/styles/notion.css" />
      <link rel="stylesheet" href="/styles/super-nav.css" />

      {/* Defer the rest of super.css to reduce render-blocking CSS (noscript fallback). */}
      <noscript>
        <link rel="stylesheet" href="/styles/super.css" />
      </noscript>
    </>
  );
}

