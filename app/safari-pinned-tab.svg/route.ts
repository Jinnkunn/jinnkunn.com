export const dynamic = "force-static";

export function GET() {
  // Safari pinned tab icon probe. We don't ship an SVG icon today.
  // Returning a stable empty SVG avoids falling through to the catch-all route.
  return new Response("", {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=604800",
    },
  });
}
