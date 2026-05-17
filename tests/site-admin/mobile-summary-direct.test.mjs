import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { handleMobileSummaryRequest } from "../../cloudflare/mobile-summary-direct.mjs";

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function issueToken({ login = "jinnkunn", env = "staging", secret = "secret" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: "site-admin",
    aud: "site-admin-app",
    sub: login,
    env,
    iat: now,
    exp: now + 300,
  }));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function fakeDb() {
  return {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async first() {
              if (sql.includes("rel_path = ?") && bindings[0] === "now.json") {
                return {
                  body: JSON.stringify({
                    current: {
                      text: "Testing mobile summary.",
                      context: "iOS",
                      location: "Halifax",
                      updatedAt: "2026-05-17T12:00:00.000Z",
                    },
                    updates: [{ id: "1", text: "Testing", at: "2026-05-17T12:00:00.000Z" }],
                  }),
                };
              }
              if (sql.includes("LIKE 'posts/%'")) return { count: 8 };
              if (sql.includes("LIKE 'pages/%'")) return { count: 12 };
              if (sql.includes("calendar_public_sync_state")) {
                return {
                  generated_at: "2026-05-17T12:01:00.000Z",
                  range_starts_at: "2026-05-01T00:00:00.000Z",
                  range_ends_at: "2026-06-01T00:00:00.000Z",
                  event_count: 4,
                };
              }
              if (sql.includes("ORDER BY updated_at DESC")) return { sha: "abcdef123456" };
              return null;
            },
            async all() {
              if (sql.includes("FROM release_jobs")) return [];
              if (sql.includes("FROM release_agents")) return [
                {
                  agent_id: "mac-mini",
                  status: "idle",
                  current_job_id: "",
                  last_seen_at: 1779040000000,
                },
              ];
              return [];
            },
          };
        },
      };
    },
  };
}

test("mobile summary direct handler rejects missing app token", async () => {
  const res = await handleMobileSummaryRequest(
    new Request("https://staging.jinkunchen.com/api/site-admin/mobile/summary"),
    {
      NEXTAUTH_SECRET: "secret",
      SITE_ADMIN_GITHUB_USERS: "jinnkunn",
      SITE_ADMIN_DB: fakeDb(),
    },
  );
  assert.equal(res.status, 401);
});

test("mobile summary direct handler returns compact iOS payload", async () => {
  const token = issueToken();
  const res = await handleMobileSummaryRequest(
    new Request("https://staging.jinkunchen.com/api/site-admin/mobile/summary", {
      headers: { authorization: `Bearer ${token}` },
    }),
    {
      NEXTAUTH_SECRET: "secret",
      SITE_ADMIN_GITHUB_USERS: "jinnkunn",
      SITE_ADMIN_REPO_BRANCH: "site-admin-staging",
      SITE_ADMIN_STORAGE: "db",
      SITE_ADMIN_DB: fakeDb(),
    },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.summary.now.text, "Testing mobile summary.");
  assert.equal(body.data.summary.content.posts, 8);
  assert.equal(body.data.summary.content.pages, 12);
  assert.equal(body.data.summary.calendar.eventCount, 4);
  assert.equal(body.data.summary.release.recommendedAction.kind, "noop");
});
