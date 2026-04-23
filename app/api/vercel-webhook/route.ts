import {
  noStoreErrorOnly,
  noStoreMethodNotAllowed,
  withNoStoreApi,
} from "@/lib/server/api-response";

export const runtime = "nodejs";

const RETIRED_MESSAGE =
  "This endpoint is retired. Deployment status is no longer synced from Vercel webhook.";

export async function POST() {
  return withNoStoreApi(async () =>
    noStoreErrorOnly(RETIRED_MESSAGE, {
      status: 410,
      code: "ENDPOINT_RETIRED",
    })
  );
}

export async function GET() {
  return noStoreMethodNotAllowed(["POST"]);
}
