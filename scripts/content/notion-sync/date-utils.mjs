export function toDateIso(start) {
  const s = String(start || "").trim();
  if (!s) return null;
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

export function formatDateLong(start, { timeZone } = {}) {
  const iso = toDateIso(start);
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const opts = { year: "numeric", month: "long", day: "numeric" };
  if (timeZone) opts.timeZone = timeZone;
  return new Date(t).toLocaleDateString("en-US", opts);
}

export function extractFirstDateProperty(page, { timeZone } = {}) {
  const props = page?.properties && typeof page.properties === "object" ? page.properties : {};
  for (const [name, v] of Object.entries(props)) {
    if (!v || typeof v !== "object") continue;
    if (v.type !== "date") continue;
    const start = String(v.date?.start || "").trim();
    const iso = toDateIso(start);
    const text = formatDateLong(start, { timeZone });
    if (!iso || !text) continue;
    return { name, id: String(v.id || ""), start, iso, text };
  }
  return null;
}
