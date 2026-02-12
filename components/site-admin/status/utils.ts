import type { StatusPayload, StatusResult } from "./types";
import { asApiAck, readApiErrorMessage } from "@/lib/client/api-guards";
export { readApiErrorMessage as recordErrorMessage } from "@/lib/client/api-guards";

export function asStatusResult(x: unknown): StatusResult | null {
  const ack = asApiAck(x);
  if (!ack) return null;
  if (!ack.ok) return { ok: false, error: readApiErrorMessage(ack) || "Request failed" };
  return x as StatusPayload;
}

export function fmtWhen(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return "—";
  }
}

export function fmtIso(iso?: string | null): string {
  const s = String(iso || "").trim();
  if (!s) return "—";
  return s.replace("T", " ").replace("Z", " UTC");
}

export function isoMs(iso?: string | null): number {
  const s = String(iso || "").trim();
  if (!s) return NaN;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

export function fmtDelta(ms: number): string {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const sec = Math.floor(abs / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (day > 0) return `${sign}${day}d ${hr % 24}h`;
  if (hr > 0) return `${sign}${hr}h ${min % 60}m`;
  if (min > 0) return `${sign}${min}m`;
  return `${sign}${sec}s`;
}
