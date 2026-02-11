export const dynamic = "force-static";

export function GET() {
  // Edge/Windows sometimes probes this. We don't use it, but serving a stable response
  // prevents catch-all route noise.
  return new Response("", {
    status: 200,
    headers: {
      "content-type": "text/xml; charset=utf-8",
      "cache-control": "public, max-age=604800",
    },
  });
}
