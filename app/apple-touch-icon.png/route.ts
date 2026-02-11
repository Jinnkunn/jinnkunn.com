export const dynamic = "force-static";

export function GET(req: Request) {
  // iOS/Apple devices request this implicitly.
  return Response.redirect(new URL("/assets/favicon.png", req.url), 307);
}

