import "server-only";

function envFlag(name: string): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function isServerDebugEnabled(): boolean {
  return envFlag("DEBUG_SERVER");
}

function toSafeMeta(meta: unknown): unknown {
  if (meta === null || meta === undefined) return meta;
  if (typeof meta === "string" || typeof meta === "number" || typeof meta === "boolean") return meta;
  try {
    return JSON.parse(JSON.stringify(meta));
  } catch {
    return String(meta);
  }
}

export function serverDebugLog(scope: string, message: string, meta?: unknown): void {
  if (!isServerDebugEnabled()) return;
  const prefix = `[debug:${String(scope || "server")}]`;
  if (meta === undefined) {
    console.warn(prefix, message);
    return;
  }
  console.warn(prefix, message, toSafeMeta(meta));
}
