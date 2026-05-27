import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL("/site-admin", req.url), 302);
}
