export const dynamic = "force-static";

export function GET(req: Request) {
  // Legacy iOS variant.
  return Response.redirect(new URL("/assets/favicon.png", req.url), 307);
}

