export const dynamic = "force-static";

export function GET(req: Request) {
  // Some UAs request /manifest.json; canonicalize to /site.webmanifest.
  return Response.redirect(new URL("/site.webmanifest", req.url), 307);
}

