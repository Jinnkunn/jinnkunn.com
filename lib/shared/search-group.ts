export function groupLabelForRoutePath(routePath: string): string {
  const p0 = String(routePath || "/").trim() || "/";
  const p = p0.startsWith("/") ? p0 : `/${p0}`;
  if (p === "/") return "Home";
  if (p === "/blog" || p.startsWith("/blog/")) return "Blog";
  const seg = p.split("/").filter(Boolean)[0] || "";
  if (!seg) return "Home";
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

export function groupLabelForSearchResult(
  kind: "page" | "blog" | "database" | string,
  routePath: string,
): string {
  const k = String(kind || "page").trim().toLowerCase();
  const section = groupLabelForRoutePath(routePath);
  if (k === "blog") {
    if (section === "Blog") return "Blog";
    return `Blog / ${section}`;
  }
  if (k === "database") return `Databases / ${section}`;
  return `Pages / ${section}`;
}

export function sortGroupLabels(labels: string[]): string[] {
  const arr = Array.isArray(labels) ? labels.slice() : [];
  const key = (s: string) => String(s || "").trim();
  arr.sort((a, b) => {
    const A = key(a);
    const B = key(b);
    const rank = (x: string) =>
      x === "Home"
        ? 0
        : x === "Blog"
          ? 1
          : x.startsWith("Pages / Home")
            ? 2
            : x.startsWith("Pages / ")
              ? 3
              : x.startsWith("Blog / ")
                ? 4
                : x.startsWith("Databases / ")
                  ? 5
                  : 6;
    const ra = rank(A);
    const rb = rank(B);
    if (ra !== rb) return ra - rb;
    return A.localeCompare(B);
  });
  return arr;
}
