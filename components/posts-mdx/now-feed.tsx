import "server-only";

import type { ReactElement } from "react";

import nowContent from "@/content/now.json";

import { normalizeNowData } from "@/lib/site-admin/now-normalize";
import { NowFeedClient } from "./now-feed-client";

export function NowFeed(): ReactElement {
  const data = normalizeNowData(nowContent);
  return <NowFeedClient initialData={data} />;
}
