export function normalizeStaticPathname(pathname) {
  const raw = String(pathname || "").trim();
  if (!raw || raw === "/") return "/";
  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeading.replace(/\/+$/, "") || "/";
}

function compactId(value) {
  return String(value || "").replace(/-/g, "").trim().toLowerCase();
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeMode(value) {
  return value === "exact" ? "exact" : "prefix";
}

function normalizeAuth(value) {
  return value === "github" ? "github" : "password";
}

function normalizeRule(value) {
  const row = asRecord(value);
  const id = String(row.id || "").trim();
  const path = normalizeStaticPathname(row.path || "");
  const pageId = compactId(row.pageId);
  if (!id || (!path && !pageId)) return null;
  return {
    id,
    key: row.key === "pageId" ? "pageId" : "path",
    pageId,
    path,
    mode: normalizeMode(row.mode),
    auth: normalizeAuth(row.auth),
    token: String(row.token || "").trim(),
  };
}

function normalizeRoutesMap(value) {
  const out = {};
  const input = asRecord(value);
  for (const [route, pageId] of Object.entries(input)) {
    const normalizedRoute = normalizeStaticPathname(route);
    const normalizedPageId = compactId(pageId);
    if (normalizedRoute && normalizedPageId) out[normalizedRoute] = normalizedPageId;
  }
  return out;
}

function normalizeParentByPageId(value) {
  const out = {};
  const input = asRecord(value);
  for (const [pageId, parentId] of Object.entries(input)) {
    const normalizedPageId = compactId(pageId);
    if (!normalizedPageId) continue;
    out[normalizedPageId] = compactId(parentId);
  }
  return out;
}

export function normalizeStaticProtectionPolicy(value) {
  const input = asRecord(value);
  const rulesInput = Array.isArray(input.rules) ? input.rules : [];
  return {
    rules: rulesInput.map(normalizeRule).filter(Boolean),
    routesMap: normalizeRoutesMap(input.routesMap),
    parentByPageId: normalizeParentByPageId(input.parentByPageId),
  };
}

function lookupPageIdForPath(pathname, routesMap) {
  const p = normalizeStaticPathname(pathname);
  const direct = compactId(routesMap[p]);
  if (direct) return direct;
  const blog = /^\/blog\/([^/]+)$/.exec(p);
  if (!blog?.[1]) return "";
  return compactId(routesMap[`/blog/list/${blog[1]}`]);
}

function findProtectedByPageHierarchy(pageId, rules, parentByPageId) {
  const byId = {};
  for (const rule of rules) {
    if (rule.key !== "pageId") continue;
    const pid = compactId(rule.pageId || rule.id);
    if (!pid) continue;
    if (!byId[pid] || byId[pid].auth !== "password") byId[pid] = rule;
  }

  let cur = compactId(pageId);
  let guard = 0;
  while (cur && guard < 100) {
    const hit = byId[cur];
    if (hit) return hit;
    cur = compactId(parentByPageId[cur]);
    guard += 1;
  }
  return null;
}

function findProtectedByPath(pathname, rules) {
  const p = normalizeStaticPathname(pathname);

  for (const rule of rules) {
    if (rule.mode !== "exact") continue;
    const rp = normalizeStaticPathname(rule.path);
    if (rp === p || p.startsWith(`${rp}/`)) return rule;
  }

  let best = null;
  for (const rule of rules) {
    if (rule.mode !== "prefix") continue;
    const rp = normalizeStaticPathname(rule.path);
    if (rp === "/") continue;
    if (p === rp || p.startsWith(`${rp}/`)) {
      if (!best || rp.length > normalizeStaticPathname(best.path).length) best = rule;
    }
  }
  return best;
}

export function pickStaticProtectedRule(pathname, policy) {
  const normalized = normalizeStaticProtectionPolicy(policy);
  if (normalized.rules.length === 0) return null;
  const pageId = lookupPageIdForPath(pathname, normalized.routesMap);
  const byPage = pageId
    ? findProtectedByPageHierarchy(pageId, normalized.rules, normalized.parentByPageId)
    : null;
  return byPage || findProtectedByPath(pathname, normalized.rules);
}

export function isStaticProtectionSatisfied(rule, cookieHeader, parseCookieHeader) {
  if (!rule) return true;
  if (rule.auth !== "password") return false;
  if (!rule.token) return false;
  const cookies = parseCookieHeader(cookieHeader);
  return cookies.get(`site_auth_${rule.id}`) === rule.token;
}
