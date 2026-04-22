import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const m = String(file || "").match(/^([0-9a-f]{32})\.[a-z0-9]{1,6}$/i);
  if (!m) return new NextResponse("Not found", { status: 404 });
  return new NextResponse("Not found", { status: 404 });
}
