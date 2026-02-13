export { isApiOk, readApiErrorMessage } from "@/lib/client/api-guards";

export function errorFromUnknown(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

export function asString(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export function asNumber(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
