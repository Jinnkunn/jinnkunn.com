export const dynamic = "force-static";

export function GET(req: Request) {
  // Some browsers request `/favicon.ico` even when a PNG icon is declared.
  // Serve a stable redirect so this doesn't fall through to the catch-all route.
  return Response.redirect(new URL("/assets/favicon.png", req.url), 307);
}

