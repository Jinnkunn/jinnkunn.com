import { createFlagsDiscoveryEndpoint, getProviderData } from "flags/next";

import { ALL_SERVER_FLAGS } from "@/lib/flags";

export const runtime = "nodejs";

export const GET = createFlagsDiscoveryEndpoint(() =>
  getProviderData({
    flags: ALL_SERVER_FLAGS,
  }),
);
