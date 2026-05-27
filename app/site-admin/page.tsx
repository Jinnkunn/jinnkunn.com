import type { Metadata } from "next";
import Link from "next/link";
import type { NextRequest } from "next/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusNotice } from "@/components/ui/status-notice";
import {
  getSiteAdminSessionIdentity,
  isAllowedAdminSessionIdentity,
} from "@/lib/site-admin-auth";
import type { SiteAdminMobileSummary } from "@/lib/site-admin/mobile-summary";
import { getSiteAdminMobileSummary } from "@/lib/server/site-admin-mobile-service";
import styles from "./site-admin-dashboard.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Site Admin",
  description: "Authenticated Site Admin gateway",
  robots: { index: false, follow: false },
};

async function readAuthorizedIdentity() {
  const requestHeaders = await headers();
  const requestCookies = await cookies();
  const req = {
    cookies: { getAll: () => requestCookies.getAll() },
    headers: new Headers({ cookie: requestHeaders.get("cookie") || "" }),
  } as unknown as NextRequest;
  const identity = await getSiteAdminSessionIdentity(req);
  return isAllowedAdminSessionIdentity(identity) ? identity : null;
}

function formatValue(value: string) {
  return value.trim() || "Not available";
}

function formatWhen(value: string) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Halifax",
  }).format(date);
}

async function readSummary(): Promise<
  | { ok: true; summary: SiteAdminMobileSummary }
  | { ok: false; error: string }
> {
  try {
    return { ok: true, summary: await getSiteAdminMobileSummary() };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}

export default async function SiteAdminGatewayPage() {
  const identity = await readAuthorizedIdentity();
  if (!identity) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent("/site-admin")}`);
  }

  const actor = identity.email || identity.login || identity.actor;
  const summaryResult = await readSummary();
  const summary = summaryResult.ok ? summaryResult.summary : null;
  const release = summary?.release;
  const source = summary?.source;

  return (
    <main className={styles.shell}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Site Admin</p>
          <h1 className={styles.title}>Dashboard</h1>
          <p className={styles.description}>
            Signed in as <strong>{actor}</strong>. This browser view shows the live
            website control surface and release state.
          </p>
        </div>
        <div className={styles.heroActions}>
          <Button href="/api/site-admin/status" variant="subtle">
            Status
          </Button>
          <Button href="/" variant="ghost">
            Public site
          </Button>
        </div>
      </section>

      {!summaryResult.ok ? (
        <StatusNotice tone="warning">
          Summary could not be loaded: {summaryResult.error}
        </StatusNotice>
      ) : null}

      {summary ? (
        <>
          <section className={styles.summaryGrid} aria-label="Site Admin summary">
            <Card className={styles.card}>
              <div className={styles.cardHeader}>
                <p className={styles.cardLabel}>Release</p>
                <span className={styles.statusPill} data-state={release?.recommendedAction.kind}>
                  {release?.recommendedAction.label || "Refresh"}
                </span>
              </div>
              <h2 className={styles.cardTitle}>{release?.headline || "Status unavailable"}</h2>
              <p className={styles.cardText}>{release?.detail || "Refresh release status."}</p>
              <div className={styles.cardMeta}>
                <span>Runner</span>
                <strong>{release?.runners?.[0]?.status || "Not seen"}</strong>
              </div>
            </Card>

            <Card className={styles.card}>
              <div className={styles.cardHeader}>
                <p className={styles.cardLabel}>Content</p>
                <span className={styles.muted}>Draft store</span>
              </div>
              <h2 className={styles.cardTitle}>
                {summary.content.posts} posts · {summary.content.pages} pages
              </h2>
              <p className={styles.cardText}>
                Content edits are stored in Site Admin and published through the
                release flow.
              </p>
              <div className={styles.linkRow}>
                <Link href="/api/site-admin/posts">Posts API</Link>
                <Link href="/api/site-admin/pages/tree">Pages tree</Link>
              </div>
            </Card>

            <Card className={styles.card}>
              <div className={styles.cardHeader}>
                <p className={styles.cardLabel}>Now</p>
                <span className={styles.muted}>{summary.now.historyCount} updates</span>
              </div>
              <h2 className={styles.cardTitle}>{formatValue(summary.now.text)}</h2>
              <p className={styles.cardText}>
                {summary.now.context || summary.now.location || "No extra context."}
              </p>
              <div className={styles.cardMeta}>
                <span>Updated</span>
                <strong>{formatWhen(summary.now.updatedAt)}</strong>
              </div>
            </Card>

            <Card className={styles.card}>
              <div className={styles.cardHeader}>
                <p className={styles.cardLabel}>Calendar</p>
                <span className={styles.muted}>Public projection</span>
              </div>
              <h2 className={styles.cardTitle}>{summary.calendar.eventCount} events</h2>
              <p className={styles.cardText}>
                Range starts {formatWhen(summary.calendar.rangeStartsAt)}.
              </p>
              <div className={styles.linkRow}>
                <Link href="/calendar">Calendar</Link>
                <Link href="/api/public/calendar">Public API</Link>
              </div>
            </Card>
          </section>

          <section className={styles.footerGrid}>
            <Card className={styles.wideCard}>
              <p className={styles.cardLabel}>Source</p>
              <dl className={styles.kvGrid}>
                <div>
                  <dt>Branch</dt>
                  <dd>{formatValue(source?.branch || "")}</dd>
                </div>
                <div>
                  <dt>Code</dt>
                  <dd>{formatValue(source?.codeSha || "")}</dd>
                </div>
                <div>
                  <dt>Content</dt>
                  <dd>{formatValue(source?.contentSha || "")}</dd>
                </div>
                <div>
                  <dt>Pending deploy</dt>
                  <dd>{source?.pendingDeploy === true ? "Yes" : "No"}</dd>
                </div>
              </dl>
            </Card>

            <Card className={styles.wideCard}>
              <p className={styles.cardLabel}>Workspace</p>
              <p className={styles.cardText}>
                Desktop and iOS remain the primary editors. This browser dashboard
                is the authenticated control-room view for quick checks and API
                access.
              </p>
              <div className={styles.linkRow}>
                <Link href="/api/site-admin/mobile/summary">Mobile summary</Link>
                <Link href="/api/site-admin/release-jobs">Release jobs</Link>
              </div>
            </Card>
          </section>
        </>
      ) : null}
    </main>
  );
}
