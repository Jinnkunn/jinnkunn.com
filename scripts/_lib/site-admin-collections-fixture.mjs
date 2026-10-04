import { SITE_COMPONENT_DEFINITIONS } from "../../packages/content-core/src/component-registry.ts";
import { parseCollectionDraft } from "../../app/site-admin/site-admin-collection-draft.ts";

const INITIAL_SOURCES = {
  news: '---\ntitle: News\n---\n<NewsEntry entryId="news-one" date="2026-10-01">\nInitial news body.\n</NewsEntry>\n',
  teaching: '---\ntitle: Teaching\n---\n<TeachingEntry entryId="teaching-one" term="2026/27 Fall Term" period="Sep 2026 - Dec 2026" role="Instructor" courseCode="CSCI1000" courseName="Fixture course" />\n',
  works: '---\ntitle: Works\n---\n<WorksEntry entryId="recent-one" category="recent" role="Intern" affiliation="QA Labs" period="Nov 2025 - Now">\nRecent body.\n</WorksEntry>\n<WorksEntry entryId="past-one" category="passed" role="Analyst" affiliation="QA Labs" period="Jan 2024 - Dec 2024">\nPast body.\n</WorksEntry>\n',
  publications: `---\ntitle: Publications\n---\n<PublicationsEntry data='${JSON.stringify({ entryId: "pub-one", title: "Fixture paper", year: "2026", labels: ["conference"], authorsRich: [{ name: "Chen, Jinkun", isSelf: true, url: "https://example.test/author" }] })}' />\n`,
};

// This transport never forwards admin requests. Saves and releases live only in memory.
export function createCollectionsFixture() {
  const saved = new Map(Object.entries(INITIAL_SOURCES));
  const published = new Map(saved);
  const versions = new Map([...saved.keys()].map((name) => [name, 1]));
  const failures = new Map();
  const writes = [];
  const unexpected = [];
  const jobs = [];
  let releaseSnapshot = null;
  const entries = (name) => parseCollectionDraft(name, saved.get(name)).value.items;
  const summaries = () => Object.fromEntries(SITE_COMPONENT_DEFINITIONS.map((def) => [def.name, {
    count: entries(def.name).length, entryLabel: def.entryLabel, rows: [],
  }]));
  const pending = () => [...saved].some(([name, source]) => published.get(name) !== source);
  const activeJob = () => jobs.find((job) => ["running", "queued"].includes(job.status)) || null;
  const summary = () => ({
    generatedAt: new Date().toISOString(),
    site: { name: "Isolated Collections QA", environment: "staging", runtime: "fixture" },
    now: { text: "", context: "", location: "", updatedAt: "", historyCount: 0 },
    calendar: { eventCount: 0, generatedAt: "", rangeStartsAt: "", rangeEndsAt: "" },
    content: { posts: 0, pages: 0 },
    source: { storeKind: "d1", branch: "main", codeSha: "fixture", contentSha: "fixture", pendingDeploy: pending(), deployableVersionReady: true },
    release: {
      headline: activeJob() ? "Publishing" : pending() ? "Release needed" : "Up to date",
      detail: "Isolated test transport", runningJob: activeJob(), latestJob: jobs[0] || null,
      runners: [{ id: "fixture-runner", status: "idle", lastSeenAt: new Date().toISOString() }],
      recommendedAction: { kind: activeJob() ? "watch-release" : pending() ? "smart-release" : "noop", label: "Publish", destructive: false },
    },
  });
  function detail(name) {
    const definition = SITE_COMPONENT_DEFINITIONS.find((def) => def.name === name);
    return { name, title: definition.label, href: definition.primaryRoute, definition,
      source: saved.get(name), version: `fixture-${versions.get(name)}`, summary: summaries()[name] };
  }
  function completeRelease(status = "succeeded") {
    const job = activeJob();
    if (!job) throw new Error("No fixture release is active");
    Object.assign(job, { status, finishedAt: new Date().toISOString(), error: status === "failed" ? "Fixture publish failed" : "" });
    if (status === "succeeded") for (const [name, source] of releaseSnapshot) published.set(name, source);
  }
  async function handle(route) {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (req.method() === "GET") {
      if (path === "/api/site-admin/mobile/summary") return json({ summary: summary() });
      if (path === "/api/site-admin/home") return json({ data: { title: "Home", bodyMdx: "Fixture home" }, sourceVersion: { fileSha: "fixture" } });
      if (path === "/api/site-admin/now") return json({ data: { current: { text: "", context: "", location: "", updatedAt: "" }, updates: [] }, sourceVersion: { fileSha: "fixture" } });
      if (path === "/api/site-admin/posts") return json({ count: 0, posts: [] });
      if (path === "/api/site-admin/pages") return json({ count: 0, pages: [] });
      if (path === "/api/site-admin/pages/tree") return json({ slugs: [], sourceVersion: { fileSha: "fixture" } });
      if (path === "/api/site-admin/versions") return json({ path: url.searchParams.get("path"), sourceVersion: { fileSha: "fixture" }, history: [] });
      if (path === "/api/site-admin/components") return json({ components: SITE_COMPONENT_DEFINITIONS, summaries: summaries(), usage: {} });
      const name = path.match(/^\/api\/site-admin\/components\/([^/]+)$/)?.[1];
      if (saved.has(name)) return json(detail(name));
      if (path === "/api/site-admin/release-jobs") return json({ jobs, runners: { agents: summary().release.runners, queuedCount: jobs.filter((job) => job.status === "queued").length, runningCount: jobs.filter((job) => job.status === "running").length } });
    }
    if (req.method() === "PATCH") {
      const name = path.match(/^\/api\/site-admin\/components\/([^/]+)$/)?.[1];
      if (saved.has(name)) {
        const body = req.postDataJSON();
        writes.push({ name, ...body });
        if (failures.has(name)) return json({ error: failures.get(name) === 409 ? "Fixture changed elsewhere" : "Fixture save unavailable" }, failures.get(name));
        if (body.version !== detail(name).version) return json({ error: "Fixture version conflict" }, 409);
        saved.set(name, body.source); versions.set(name, versions.get(name) + 1);
        return json({ ok: true, version: detail(name).version });
      }
    }
    if (req.method() === "POST" && ["/api/site-admin/release-jobs", "/api/site-admin/release-jobs/smart"].includes(path)) {
      releaseSnapshot = new Map(saved);
      const job = { id: `fixture-job-${jobs.length + 1}`, status: "running", action: "publish-content-staging", script: "publish:content:staging", phase: "verify", createdAt: new Date().toISOString(), startedAt: new Date().toISOString() };
      jobs.unshift(job);
      return json({ job, wake: { configured: true, ok: true } });
    }
    unexpected.push(`${req.method()} ${path}`);
    return json({ error: "Unconfigured fixture request; network forwarding is forbidden" }, 503);
  }
  return { handle, saved, published, writes, unexpected, jobs, failures, entries, completeRelease,
    changeRemotely(name, source) { saved.set(name, source); versions.set(name, versions.get(name) + 1); } };
}
