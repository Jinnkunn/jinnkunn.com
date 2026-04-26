import { useCallback, useEffect, useMemo, useState } from "react";

import { JsonDraftRestoreBanner } from "./JsonDraftRestoreBanner";
import { BlocksEditor } from "./LazyBlocksEditor";
import { useSiteAdmin } from "./state";
import type { NewsData, NewsEntry } from "./types";
import { useJsonDraft } from "./use-json-draft";

const BLANK_DATA: NewsData = {
  schemaVersion: 1,
  title: "News",
  entries: [],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Render the entire news file as one markdown document. The first `#`
 * heading is the page title; each `## YYYY-MM-DD` heading begins a new
 * entry whose body is the markdown that follows up to the next `## …`. */
function entriesToMarkdown(data: { title: string; entries: NewsEntry[] }): string {
  const lines: string[] = [];
  lines.push(`# ${data.title || "News"}`);
  for (const entry of data.entries) {
    lines.push("");
    lines.push(`## ${entry.dateIso}`);
    const body = (entry.body || "").trim();
    if (body) {
      lines.push("");
      lines.push(body);
    }
  }
  return `${lines.join("\n")}\n`;
}

interface ParsedNews {
  title: string;
  entries: NewsEntry[];
}

interface ParseError {
  message: string;
  /** 1-based line number that failed validation, when available. */
  line?: number;
}

interface ParseResult {
  ok: true;
  value: ParsedNews;
}

interface ParseFail {
  ok: false;
  error: ParseError;
}

/** Inverse of entriesToMarkdown. Splits the document into entries on
 * `## YYYY-MM-DD` boundaries and rejects any non-date level-2 heading
 * to keep news.json's typed shape intact. */
function markdownToNews(markdown: string): ParseResult | ParseFail {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let title = "News";
  let titleSeen = false;
  const entries: NewsEntry[] = [];
  let currentDate: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (currentDate) {
      entries.push({
        dateIso: currentDate,
        body: currentBody.join("\n").trim(),
      });
    }
    currentDate = null;
    currentBody = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const h1 = /^#\s+(.+?)\s*$/.exec(line);
    const h2 = /^##\s+(.+?)\s*$/.exec(line);

    if (h1) {
      if (!titleSeen) {
        title = h1[1].trim() || "News";
        titleSeen = true;
        continue;
      }
      if (currentDate) {
        currentBody.push(line);
      }
      continue;
    }

    if (h2) {
      const date = h2[1].trim();
      if (!DATE_RE.test(date)) {
        return {
          ok: false,
          error: {
            message: `"## ${date}" is not a valid YYYY-MM-DD date heading. Each entry must start with a date heading like "## 2026-04-26".`,
            line: i + 1,
          },
        };
      }
      flush();
      currentDate = date;
      continue;
    }

    if (currentDate) {
      currentBody.push(line);
    }
  }
  flush();

  return { ok: true, value: { title, entries } };
}

export function NewsPanel() {
  const { connection, request, setMessage } = useSiteAdmin();
  const [baseData, setBaseData] = useState<NewsData>(BLANK_DATA);
  const [markdownDraft, setMarkdownDraft] = useState<string>(() =>
    entriesToMarkdown(BLANK_DATA),
  );
  const [description, setDescription] = useState<string>("");
  const [fileSha, setFileSha] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [parseError, setParseError] = useState<ParseError | null>(null);
  const [conflict, setConflict] = useState(false);

  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);

  const baseMarkdown = useMemo(() => entriesToMarkdown(baseData), [baseData]);
  const dirty =
    markdownDraft !== baseMarkdown ||
    (description || "") !== (baseData.description || "");

  // Drafts are restored as the markdown buffer + description, which
  // round-trips losslessly through entriesToMarkdown.
  const draftSnapshot = useMemo(
    () => ({ markdown: markdownDraft, description }),
    [markdownDraft, description],
  );
  const { restorable, clearDraft, dismissRestore } = useJsonDraft<{
    markdown: string;
    description: string;
  }>("news", draftSnapshot, dirty && !loading && !saving);

  const loadData = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!ready) return;
      setLoading(true);
      setError("");
      setParseError(null);
      const response = await request("/api/site-admin/news", "GET");
      setLoading(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        if (!options.silent) setMessage("error", `Load news failed: ${msg}`);
        return;
      }
      const data = (response.data ?? {}) as Record<string, unknown>;
      const payload = (data.data ?? {}) as Partial<NewsData>;
      const version = (data.sourceVersion ?? {}) as { fileSha?: string };
      const normalized: NewsData = {
        schemaVersion: 1,
        title: payload.title || "News",
        description: payload.description,
        entries: Array.isArray(payload.entries) ? payload.entries : [],
      };
      setBaseData(normalized);
      setMarkdownDraft(entriesToMarkdown(normalized));
      setDescription(normalized.description || "");
      setFileSha(version.fileSha || "");
      setConflict(false);
      if (!options.silent) {
        setMessage(
          "success",
          `Loaded ${normalized.entries.length} news entr${normalized.entries.length === 1 ? "y" : "ies"}.`,
        );
      }
    },
    [ready, request, setMessage],
  );

  useEffect(() => {
    if (!ready) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData({ silent: true });
  }, [ready, loadData]);

  const save = useCallback(async () => {
    if (!ready || saving) return;
    const parsed = markdownToNews(markdownDraft);
    if (!parsed.ok) {
      setParseError(parsed.error);
      setMessage("error", parsed.error.message);
      return;
    }
    setParseError(null);
    setSaving(true);
    setError("");
    const payload: NewsData = {
      schemaVersion: 1,
      title: parsed.value.title,
      description: description.trim() || undefined,
      entries: parsed.value.entries,
    };
    const response = await request("/api/site-admin/news", "POST", {
      data: payload,
      expectedFileSha: fileSha,
    });
    setSaving(false);
    if (!response.ok) {
      const msg = `${response.code}: ${response.error}`;
      if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
        setConflict(true);
        setMessage(
          "warn",
          "News changed on the server. Reload latest and re-apply.",
        );
        return;
      }
      setError(msg);
      setMessage("error", `Save news failed: ${msg}`);
      return;
    }
    const data = (response.data ?? {}) as Record<string, unknown>;
    const version = (data.sourceVersion ?? {}) as { fileSha?: string };
    setBaseData(payload);
    setMarkdownDraft(entriesToMarkdown(payload));
    setFileSha(version.fileSha || "");
    setConflict(false);
    clearDraft();
    setMessage(
      "success",
      `News saved (${payload.entries.length} entr${payload.entries.length === 1 ? "y" : "ies"}).`,
    );
  }, [
    ready,
    saving,
    markdownDraft,
    description,
    fileSha,
    request,
    clearDraft,
    setMessage,
  ]);

  const entryCount = useMemo(() => {
    const parsed = markdownToNews(markdownDraft);
    return parsed.ok ? parsed.value.entries.length : 0;
  }, [markdownDraft]);

  const stateNote = loading
    ? "Loading…"
    : conflict
      ? "Conflict detected. Reload latest before saving."
      : parseError
        ? `Cannot save: ${parseError.message}`
        : dirty
          ? "Unsaved changes."
          : "In sync.";

  return (
    <section className="surface-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            News
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Edit the entire news file as one document. The first <code>#</code>{" "}
            heading is the page title; every <code>## YYYY-MM-DD</code> heading
            starts a new entry. Saves to <code>content/news.json</code>; the{" "}
            <code>&lt;NewsBlock /&gt;</code> block embeds it in any page.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => void loadData()}
            disabled={!ready || loading}
          >
            {loading ? "Loading…" : "Reload"}
          </button>
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => void save()}
            disabled={
              !ready || saving || !dirty || conflict || parseError !== null
            }
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {error && (
        <p className="m-0 text-[12px] text-[color:var(--color-danger)]">{error}</p>
      )}
      <p className="m-0 text-[12px] text-text-muted">
        {stateNote} · {entryCount} entr{entryCount === 1 ? "y" : "ies"}
      </p>

      {restorable && (
        <JsonDraftRestoreBanner
          savedAt={restorable.savedAt}
          onDismiss={dismissRestore}
          onRestore={() => {
            setMarkdownDraft(restorable.value.markdown);
            setDescription(restorable.value.description);
            dismissRestore();
          }}
        />
      )}

      <details className="surface-details">
        <summary>SEO description</summary>
        <p className="m-0 mt-1 text-[12px] text-text-muted">
          Used in <code>&lt;meta name="description"&gt;</code> for the{" "}
          <code>/news</code> page. Not visible on the page itself.
        </p>
        <input
          className="mt-2 w-full"
          type="text"
          value={description}
          placeholder="Short summary for search engines and link previews."
          onChange={(event) => setDescription(event.target.value)}
        />
      </details>

      <BlocksEditor
        value={markdownDraft}
        onChange={(next) => {
          setMarkdownDraft(next);
          // Re-validate on every change so the user sees errors live and
          // the Save button stays accurate.
          const parsed = markdownToNews(next);
          setParseError(parsed.ok ? null : parsed.error);
        }}
        minHeight={420}
      />
    </section>
  );
}

// Exported for unit tests in news-panel.test.ts.
export { entriesToMarkdown, markdownToNews };
