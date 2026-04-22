import crypto from "node:crypto";
import { z } from "zod";

import {
  noStoreBadRequest,
  noStoreMethodNotAllowed,
  noStoreMisconfigured,
  noStoreOk,
  noStoreUnauthorized,
  withNoStoreApi,
} from "@/lib/server/api-response";

const webhookEventSchema = z
  .object({
    type: z.string().optional(),
    createdAt: z.union([z.number(), z.string()]).optional(),
    payload: z
      .object({
        id: z.string().optional(),
        url: z.string().optional(),
        deployment: z
          .object({
            id: z.string().optional(),
            url: z.string().optional(),
            target: z.string().optional(),
          })
          .partial()
          .optional(),
        links: z
          .object({
            deployment: z.string().optional(),
          })
          .partial()
          .optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

export const runtime = "nodejs";

function normalizeSignature(sig: string): string {
  const s = String(sig || "").trim();
  if (!s) return "";
  if (s.startsWith("sha1=")) return s.slice("sha1=".length);
  return s;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function verifyVercelSignature(opts: { rawBody: string; secret: string; got: string }) {
  const expected = crypto
    .createHmac("sha1", opts.secret)
    .update(opts.rawBody, "utf8")
    .digest("hex");
  const got = normalizeSignature(opts.got);
  if (!got) return false;
  return timingSafeEqualHex(got, expected);
}

export async function POST(req: Request) {
  return withNoStoreApi(async () => {
    const secret = process.env.VERCEL_WEBHOOK_SECRET?.trim() ?? "";
    if (!secret) {
      return noStoreMisconfigured("VERCEL_WEBHOOK_SECRET");
    }

    const sig = req.headers.get("x-vercel-signature") ?? "";
    const rawBody = await req.text();
    if (!verifyVercelSignature({ rawBody, secret, got: sig })) {
      return noStoreUnauthorized();
    }

    let evt: unknown = null;
    try {
      evt = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      return noStoreBadRequest("Invalid JSON body");
    }

    const parsedEvent = webhookEventSchema.safeParse(evt);
    if (!parsedEvent.success) return noStoreBadRequest("Invalid webhook payload");
    const evtObj = parsedEvent.data;
    const eventType = String(evtObj.type ?? "").trim();
    if (!eventType) return noStoreOk({ skipped: true });
    return noStoreOk({ received: true, eventType });
  }, { status: 500, fallback: "Unexpected webhook handler error" });
}

export async function GET() {
  return noStoreMethodNotAllowed(["POST"]);
}
