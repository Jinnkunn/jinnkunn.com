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
    </>
  );
}
