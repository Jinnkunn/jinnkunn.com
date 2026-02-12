import "server-only";

export function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = await req.json();
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}

export async function readFormBody(req: Request): Promise<FormData | null> {
  try {
    return await req.formData();
  } catch {
    return null;
  }
}

export function getString(
  o: Record<string, unknown>,
  key: string,
  opts?: { trim?: boolean; maxLen?: number },
): string {
  const raw = o[key];
  const s = typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
  const out = opts?.trim === false ? s : s.trim();
  if (opts?.maxLen && out.length > opts.maxLen) return out.slice(0, opts.maxLen);
  return out;
}

export function getFormString(
  form: FormData,
  key: string,
  opts?: { trim?: boolean; maxLen?: number },
): string {
  const raw = form.get(key);
  const s = typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
  const out = opts?.trim === false ? s : s.trim();
  if (opts?.maxLen && out.length > opts.maxLen) return out.slice(0, opts.maxLen);
  return out;
}

export function getBoolean(o: Record<string, unknown>, key: string): boolean | null {
  const raw = o[key];
  if (typeof raw === "boolean") return raw;
  if (raw === null || raw === undefined) return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

export function getNumber(o: Record<string, unknown>, key: string): number | null {
  const raw = o[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function getEnum<T extends string>(
  o: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const v = getString(o, key).toLowerCase();
  for (const a of allowed) if (v === a) return a;
  return fallback;
}
