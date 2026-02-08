import fs from "node:fs";
import path from "node:path";
import { cache } from "react";

export type NavItem = {
  href: string;
  label: string;
};

export type SiteConfig = {
  siteName: string; // Used in the navbar logo text.
  lang: string; // HTML <html lang="">
  seo: {
    title: string;
    description: string;
    favicon: string; // Path under /public (e.g. "/assets/favicon.png")
  };
  nav: {
    top: NavItem[];
    more: NavItem[];
  };
};

const DEFAULT_CONFIG: SiteConfig = {
  siteName: "Jinkun Chen.",
  lang: "en",
  seo: {
    title: "Jinkun Chen",
    description:
      "Jinkun Chen (he/him/his) — Ph.D. student studying Computer Science at Dalhousie University.",
    favicon: "/assets/favicon.png",
  },
  nav: {
    top: [
      { href: "/", label: "Home" },
      { href: "/news", label: "News" },
      { href: "/publications", label: "Publications" },
      { href: "/works", label: "Works" },
    ],
    more: [
      { href: "/blog", label: "Blog" },
      { href: "/teaching", label: "Teaching" },
      { href: "/bio", label: "BIO" },
      { href: "/notice", label: "Notice" },
    ],
  },
};

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function asString(x: unknown): string | undefined {
  return typeof x === "string" && x.trim() ? x : undefined;
}

function asNavItems(x: unknown): NavItem[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: NavItem[] = [];
  for (const it of x) {
    if (!isObject(it)) continue;
    const href = asString(it.href);
    const label = asString(it.label);
    if (!href || !label) continue;
    out.push({ href, label });
  }
  return out.length ? out : undefined;
}

function normalizeConfig(input: unknown): SiteConfig {
  if (!isObject(input)) return DEFAULT_CONFIG;

  const cfg: SiteConfig = structuredClone(DEFAULT_CONFIG);

  cfg.siteName = asString(input.siteName) ?? cfg.siteName;
  cfg.lang = asString(input.lang) ?? cfg.lang;

  if (isObject(input.seo)) {
    cfg.seo.title = asString(input.seo.title) ?? cfg.seo.title;
    cfg.seo.description =
      asString(input.seo.description) ?? cfg.seo.description;
    cfg.seo.favicon = asString(input.seo.favicon) ?? cfg.seo.favicon;
  }

  if (isObject(input.nav)) {
    cfg.nav.top = asNavItems(input.nav.top) ?? cfg.nav.top;
    cfg.nav.more = asNavItems(input.nav.more) ?? cfg.nav.more;
  }

  return cfg;
}

function readJsonFile(filePath: string): unknown | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findConfigFile(): string | null {
  const candidates = [
    path.join(process.cwd(), "content", "generated", "site-config.json"),
    path.join(process.cwd(), "content", "site-config.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

export const getSiteConfig = cache((): SiteConfig => {
  const file = findConfigFile();
  if (!file) return DEFAULT_CONFIG;
  const parsed = readJsonFile(file);
  return normalizeConfig(parsed);
});

