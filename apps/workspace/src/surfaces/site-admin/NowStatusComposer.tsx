import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Pencil,
  RefreshCcw,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";

import { useSiteAdmin } from "./state";
import { normalizeString, productionReadOnlyMessage } from "./utils";

const STATUS_MAX_LENGTH = 180;
const CONTEXT_MAX_LENGTH = 180;
const LOCATION_MAX_LENGTH = 80;
const DISPLAY_TIME_ZONE = "America/Halifax";

type NowData = {
  current: {
    text: string;
    context?: string;
    location?: string;
    updatedAt?: string;
  };
  updates: Array<{
    id: string;
    text: string;
    at: string;
  }>;
  links: Array<{
    label: string;
    href: string;
  }>;
};

type HistoryDraft = {
  id: string;
  text: string;
  date: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseNowData(raw: unknown): NowData {
  const root = isRecord(raw) ? raw : {};
  const currentRaw = isRecord(root.current) ? root.current : {};
  const current: NowData["current"] = {
    text: readText(currentRaw.text) || "Working quietly.",
  };
  const context = readText(currentRaw.context);
  const location = readText(currentRaw.location);
  const updatedAt = readText(currentRaw.updatedAt);
  if (context) current.context = context;
  if (location) current.location = location;
  if (updatedAt) current.updatedAt = updatedAt;
  return {
    current,
    updates: Array.isArray(root.updates)
      ? root.updates
          .map((item) => {
            if (!isRecord(item)) return null;
            const id = readText(item.id);
            const text = readText(item.text);
            const at = readText(item.at);
            return id && text && at ? { id, text, at } : null;
          })
          .filter((item): item is NowData["updates"][number] => Boolean(item))
      : [],
    links: Array.isArray(root.links)
      ? root.links
          .map((item) => {
            if (!isRecord(item)) return null;
            const label = readText(item.label);
            const href = readText(item.href);
            return label && href ? { label, href } : null;
          })
          .filter((item): item is NowData["links"][number] => Boolean(item))
      : [],
  };
}

function parsePayload(raw: unknown): { data: NowData; fileSha: string } {
  const payload = isRecord(raw) ? raw : {};
  const data = parseNowData(payload.data);
  const sourceVersion = isRecord(payload.sourceVersion) ? payload.sourceVersion : {};
  return {
    data,
    fileSha: readText(sourceVersion.fileSha),
  };
}

function formatUpdatedAt(value: string | undefined): string {
  if (!value) return "Not published yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function dateInputFromDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return [read("year"), read("month"), read("day")].filter(Boolean).join("-");
}

function todayDateInput(): string {
  return dateInputFromDate(new Date());
}

function dateInputFromTimestamp(value: string | undefined): string {
  if (!value) return todayDateInput();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? todayDateInput() : dateInputFromDate(date);
}

export function NowStatusComposer() {
  const {
    bumpContentRevision,
    connection,
    productionReadOnly,
    request,
    setMessage,
  } = useSiteAdmin();
  const [current, setCurrent] = useState<NowData | null>(null);
  const [fileSha, setFileSha] = useState("");
  const [draftText, setDraftText] = useState("");
  const [draftDate, setDraftDate] = useState(() => todayDateInput());
  const [context, setContext] = useState("");
  const [location, setLocation] = useState("");
  const [editingHistory, setEditingHistory] = useState<HistoryDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      setLoading(true);
      setError("");
      const response = await request("/api/site-admin/now", "GET");
      setLoading(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        if (!options.silent) setMessage("error", `Load Now failed: ${msg}`);
        return;
      }
      const payload = parsePayload(response.data);
      setCurrent(payload.data);
      setFileSha(payload.fileSha);
      setContext(payload.data.current.context || "");
      setLocation(payload.data.current.location || "");
      setDraftDate(todayDateInput());
      setEditingHistory(null);
      if (!options.silent) setMessage("success", "Now status loaded.");
    },
    [request, setMessage],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load({ silent: true });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [connection.baseUrl, load]);

  const trimmedDraft = normalizeString(draftText);
  const canSubmit = Boolean(trimmedDraft) && !loading && !saving && !productionReadOnly;
  const characterCount = useMemo(
    () => `${trimmedDraft.length}/${STATUS_MAX_LENGTH}`,
    [trimmedDraft.length],
  );

  const submit = useCallback(async () => {
    if (productionReadOnly) {
      setMessage("warn", productionReadOnlyMessage("update Now"));
      return;
    }
    const text = normalizeString(draftText);
    if (!text) {
      setMessage("warn", "Write a short status first.");
      return;
    }
    setSaving(true);
    setError("");
    const response = await request("/api/site-admin/now", "POST", {
      action: "create",
      text,
      context: normalizeString(context),
      location: normalizeString(location),
      date: draftDate,
      expectedFileSha: fileSha,
    });
    setSaving(false);
    if (!response.ok) {
      const msg = `${response.code}: ${response.error}`;
      setError(msg);
      setMessage("error", `Update Now failed: ${msg}`);
      return;
    }
    const payload = parsePayload(response.data);
    setCurrent(payload.data);
    setFileSha(payload.fileSha);
    setDraftText("");
    setDraftDate(todayDateInput());
    bumpContentRevision();
    setMessage("success", "Now updated. Publish staging when ready.");
  }, [
    bumpContentRevision,
    context,
    draftDate,
    draftText,
    fileSha,
    location,
    productionReadOnly,
    request,
    setMessage,
  ]);

  const saveHistory = useCallback(async () => {
    if (productionReadOnly) {
      setMessage("warn", productionReadOnlyMessage("update Now history"));
      return;
    }
    if (!editingHistory) return;
    const text = normalizeString(editingHistory.text);
    if (!text) {
      setMessage("warn", "History text cannot be empty.");
      return;
    }
    setSaving(true);
    setError("");
    const response = await request("/api/site-admin/now", "POST", {
      action: "update-history",
      id: editingHistory.id,
      text,
      date: editingHistory.date,
      expectedFileSha: fileSha,
    });
    setSaving(false);
    if (!response.ok) {
      const msg = `${response.code}: ${response.error}`;
      setError(msg);
      setMessage("error", `Update Now history failed: ${msg}`);
      return;
    }
    const payload = parsePayload(response.data);
    setCurrent(payload.data);
    setFileSha(payload.fileSha);
    setEditingHistory(null);
    bumpContentRevision();
    setMessage("success", "Now history updated. Publish staging when ready.");
  }, [
    bumpContentRevision,
    editingHistory,
    fileSha,
    productionReadOnly,
    request,
    setMessage,
  ]);

  const deleteHistory = useCallback(
    async (id: string) => {
      if (productionReadOnly) {
        setMessage("warn", productionReadOnlyMessage("delete Now history"));
        return;
      }
      if (!window.confirm("Delete this Now history item?")) return;
      setSaving(true);
      setError("");
      const response = await request("/api/site-admin/now", "POST", {
        action: "delete-history",
        id,
        expectedFileSha: fileSha,
      });
      setSaving(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        setMessage("error", `Delete Now history failed: ${msg}`);
        return;
      }
      const payload = parsePayload(response.data);
      setCurrent(payload.data);
      setFileSha(payload.fileSha);
      setEditingHistory(null);
      bumpContentRevision();
      setMessage("success", "Now history deleted. Publish staging when ready.");
    },
    [bumpContentRevision, fileSha, productionReadOnly, request, setMessage],
  );

  const historyUpdates = current?.updates ?? [];

  return (
    <section className="now-status-composer" aria-label="Quick Now status">
      <div className="now-status-composer__head">
        <div>
          <h2>Now</h2>
          <p>{current?.current.text || "Working quietly."}</p>
        </div>
        <button
          type="button"
          className="btn btn--ghost now-status-composer__reload"
          disabled={loading || saving}
          onClick={() => void load()}
          title="Reload Now status"
        >
          <RefreshCcw
            absoluteStrokeWidth
            aria-hidden="true"
            focusable="false"
            size={14}
            strokeWidth={1.7}
          />
          <span>{loading ? "Loading" : "Reload"}</span>
        </button>
      </div>

      <div className="now-status-composer__form">
        <label className="now-status-composer__main-field">
          <span>Status</span>
          <textarea
            maxLength={STATUS_MAX_LENGTH}
            placeholder="A tiny update for /now..."
            value={draftText}
            disabled={productionReadOnly || saving}
            onChange={(event) => setDraftText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </label>
        <label className="now-status-composer__date-field">
          <span>Date</span>
          <input
            type="date"
            value={draftDate}
            disabled={productionReadOnly || saving}
            onChange={(event) => setDraftDate(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn--primary now-status-composer__submit"
          disabled={!canSubmit}
          onClick={() => void submit()}
          title="Update /now status"
        >
          <SendHorizontal
            absoluteStrokeWidth
            aria-hidden="true"
            focusable="false"
            size={15}
            strokeWidth={1.8}
          />
          <span>{saving ? "Updating" : "Update"}</span>
        </button>
      </div>

      <div className="now-status-composer__meta">
        <label>
          <span>Context</span>
          <input
            maxLength={CONTEXT_MAX_LENGTH}
            value={context}
            disabled={productionReadOnly || saving}
            placeholder="Research, writing, systems..."
            onChange={(event) => setContext(event.target.value)}
          />
        </label>
        <label>
          <span>Place</span>
          <input
            maxLength={LOCATION_MAX_LENGTH}
            value={location}
            disabled={productionReadOnly || saving}
            placeholder="Halifax"
            onChange={(event) => setLocation(event.target.value)}
          />
        </label>
        <div className="now-status-composer__stamp">
          <span>{characterCount}</span>
          <time dateTime={current?.current.updatedAt}>
            {formatUpdatedAt(current?.current.updatedAt)}
          </time>
        </div>
      </div>

      {historyUpdates.length > 0 ? (
        <div className="now-status-composer__history">
          <div className="now-status-composer__history-head">
            <h3>History</h3>
            <span>{historyUpdates.length}</span>
          </div>
          <ol className="now-status-composer__updates" aria-label="Now history updates">
            {historyUpdates.map((item) => {
              const isEditing = editingHistory?.id === item.id;
              return (
                <li
                  className={isEditing ? "now-status-composer__update--editing" : ""}
                  key={item.id}
                >
                  {isEditing ? (
                    <>
                      <input
                        type="date"
                        value={editingHistory.date}
                        disabled={saving}
                        onChange={(event) =>
                          setEditingHistory({
                            ...editingHistory,
                            date: event.target.value,
                          })
                        }
                      />
                      <input
                        maxLength={STATUS_MAX_LENGTH}
                        value={editingHistory.text}
                        disabled={saving}
                        onChange={(event) =>
                          setEditingHistory({
                            ...editingHistory,
                            text: event.target.value,
                          })
                        }
                      />
                      <div className="now-status-composer__update-actions">
                        <button
                          type="button"
                          className="btn btn--ghost"
                          disabled={saving}
                          onClick={() => void saveHistory()}
                          title="Save history item"
                        >
                          <Check
                            absoluteStrokeWidth
                            aria-hidden="true"
                            focusable="false"
                            size={14}
                            strokeWidth={1.8}
                          />
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          disabled={saving}
                          onClick={() => setEditingHistory(null)}
                          title="Cancel editing"
                        >
                          <X
                            absoluteStrokeWidth
                            aria-hidden="true"
                            focusable="false"
                            size={14}
                            strokeWidth={1.8}
                          />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <time dateTime={item.at}>{formatUpdatedAt(item.at)}</time>
                      <span>{item.text}</span>
                      <div className="now-status-composer__update-actions">
                        <button
                          type="button"
                          className="btn btn--ghost"
                          disabled={productionReadOnly || saving}
                          onClick={() =>
                            setEditingHistory({
                              id: item.id,
                              text: item.text,
                              date: dateInputFromTimestamp(item.at),
                            })
                          }
                          title="Edit history item"
                        >
                          <Pencil
                            absoluteStrokeWidth
                            aria-hidden="true"
                            focusable="false"
                            size={14}
                            strokeWidth={1.8}
                          />
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          disabled={productionReadOnly || saving}
                          onClick={() => void deleteHistory(item.id)}
                          title="Delete history item"
                        >
                          <Trash2
                            absoluteStrokeWidth
                            aria-hidden="true"
                            focusable="false"
                            size={14}
                            strokeWidth={1.8}
                          />
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {error ? <p className="now-status-composer__error">{error}</p> : null}
    </section>
  );
}
