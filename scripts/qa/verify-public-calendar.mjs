import { loadProjectEnv } from "../_lib/load-project-env.mjs";
import { createNextAuthSessionCookie } from "../_lib/site-admin-auth-cookie.mjs";
import { verifyPublicCalendarFeeds } from "../_lib/verify-public-calendar.mjs";

async function main() {
  const environment = process.argv.slice(2)[0];
  if (environment !== "staging" && environment !== "production") {
    throw new Error("Pass staging or production to verify-public-calendar.");
  }
  const staging = environment === "staging";
  const origin = staging ? "https://staging.jinkunchen.com" : "https://jinkunchen.com";
  let cookie;
  if (staging) {
    loadProjectEnv({ override: true, files: [".env"] });
    const auth = await createNextAuthSessionCookie({ subjectPrefix: "calendar-release-qa" });
    if (!auth.ok) throw new Error("A staging verification session is required for public calendar QA.");
    cookie = auth.cookie;
  }
  const summary = await verifyPublicCalendarFeeds((path) => fetch(origin + path, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    ...(cookie && { headers: { cookie } }),
    signal: AbortSignal.timeout(12_000),
  }));
  console.log("[verify-public-calendar]", JSON.stringify({ environment, ...summary }));
}

main().catch((error) => {
  console.error("[verify-public-calendar]", error instanceof SyntaxError ? "Invalid calendar JSON." : error.message);
  process.exitCode = 1;
});
