import {
  documentLoadSchema,
  documentSaveSchema,
  listSnapshotSchema,
  pageListRowSchema,
  postListRowSchema,
} from "@jinnkunn/contracts/schemas";
import {
  isRecord,
  type NormalizedApiResponse,
} from "@jinnkunn/contracts/transport";
import type {
  SiteAdminPageListRow,
  SiteAdminPostListRow,
} from "@jinnkunn/contracts/api";

export type TauriHttpResponse = { status?: number; body?: unknown };

export function normalizeTauriApiResponse(
  rawResponse: unknown,
): NormalizedApiResponse {
  if (!isRecord(rawResponse)) {
    return {
      ok: false,
      status: 0,
      code: "INVALID_RESPONSE",
      error: "Invalid Tauri response",
      raw: rawResponse,
    };
  }
  const status = Number(rawResponse.status ?? 0);
  const body = rawResponse.body;
  if (!isRecord(body)) {
    return {
      ok: false,
      status,
      code: "INVALID_RESPONSE",
      error: "Response body is not JSON object",
      raw: rawResponse,
    };
  }
  if (body.ok === false) {
    return {
      ok: false,
      status,
      code: typeof body.code === "string" && body.code.trim()
        ? body.code.trim()
        : "REQUEST_FAILED",
      error: typeof body.error === "string" && body.error.trim()
        ? body.error.trim()
        : "Request failed",
      raw: body,
    };
  }
  if (body.ok === true) {
    return {
      ok: true,
      status,
      data: body.data ?? body,
      raw: body,
    };
  }
  return {
    ok: false,
    status,
    code: "INVALID_ENVELOPE",
    error: "Response envelope missing ok/data fields",
    raw: body,
  };
}

export type SiteAdminEnvelopeResult =
  | { ok: true; data: unknown }
  | { ok: false; code: string; error: string };

export function unwrapSiteAdminApiEnvelope(raw: unknown): SiteAdminEnvelopeResult {
  if (!isRecord(raw)) {
    return {
      ok: false,
      code: "INVALID_RESPONSE",
      error: "Site Admin API returned a non-object response.",
    };
  }
  if (raw.ok === false) {
    return {
      ok: false,
      code: typeof raw.code === "string" && raw.code.trim()
        ? raw.code.trim()
        : "REQUEST_FAILED",
      error: typeof raw.error === "string" && raw.error.trim()
        ? raw.error.trim()
        : "Site Admin API request failed.",
    };
  }
  if (raw.ok === true) return { ok: true, data: raw.data ?? raw };
  return { ok: true, data: raw };
}

export type DocumentLoadPayload = { source: string; version: string };

export function decodeDocumentLoad(data: unknown): DocumentLoadPayload | null {
  const parsed = documentLoadSchema.safeParse(data);
  if (!parsed.success) return null;
  return {
    source: parsed.data.source,
    version: parsed.data.version ?? parsed.data.sourceVersion?.fileSha ?? "",
  };
}

export type DocumentSavePayload = { version: string; fileSha: string };

export function decodeDocumentSave(data: unknown): DocumentSavePayload {
  const parsed = documentSaveSchema.safeParse(data);
  if (!parsed.success) return { version: "", fileSha: "" };
  return {
    version: parsed.data.version ?? "",
    fileSha: parsed.data.sourceVersion?.fileSha ?? "",
  };
}

export function decodeListSnapshot(data: unknown): { rows: unknown[] } | null {
  const parsed = listSnapshotSchema.safeParse(data);
  if (!parsed.success) return null;
  return { rows: Array.isArray(parsed.data) ? parsed.data : parsed.data.rows };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parsePostListRow(raw: unknown): SiteAdminPostListRow | null {
  const parsed = postListRowSchema.safeParse(raw);
  if (!parsed.success) return null;
  const row = parsed.data;
  return {
    slug: row.slug,
    href: clean(row.href) || `/blog/${row.slug}`,
    title: clean(row.title) || row.slug,
    dateIso: row.dateIso ?? null,
    dateText: row.dateText ?? null,
    description: row.description ?? null,
    draft: row.draft ?? false,
    tags: row.tags ?? [],
    wordCount: row.wordCount ?? 0,
    readingMinutes: row.readingMinutes ?? 0,
    version: clean(row.version),
  };
}

export function parsePageListRow(raw: unknown): SiteAdminPageListRow | null {
  const parsed = pageListRowSchema.safeParse(raw);
  if (!parsed.success) return null;
  const row = parsed.data;
  return {
    slug: row.slug,
    href: clean(row.href) || `/pages/${row.slug}`,
    title: clean(row.title) || row.slug,
    description: row.description ?? null,
    updatedIso: row.updatedIso ?? null,
    draft: row.draft ?? false,
    wordCount: row.wordCount ?? 0,
    readingMinutes: row.readingMinutes ?? 0,
    version: clean(row.version),
  };
}
