export default function Head() {
  return (
    <>
      {/* Editorial v2: same self-hosted body font; load early. */}
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

