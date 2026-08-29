import type { SitemapAutoExcludeConfig } from "./sitemap-policy.ts";

export type DefaultNavItem = {
  href: string;
  label: string;
};

export type DefaultSiteConfig = {
  siteName: string;
  lang: string;
  seo: {
    title: string;
    description: string;
    favicon: string;
    ogImage: string;
    pageOverrides: Record<
      string,
      {
        title?: string;
        description?: string;
        ogImage?: string;
        canonicalPath?: string;
        noindex?: boolean;
      }
    >;
  };
  integrations: {
    googleAnalyticsId: string;
  };
  security: {
    contentGithubUsers: string[];
  };
  memorial: {
    enabled: boolean;
    scope: "home" | "all-public";
    eyebrow: string;
    title: string;
    context: string;
    englishTitle: string;
    message: string;
    chineseTitle: string;
    chineseMessage: string;
    sourceLabel: string;
    sourceUrl: string;
    sourceChineseLabel: string;
    sourceChineseUrl: string;
    startsAt: string;
    endsAt: string;
  };
  nav: {
    top: DefaultNavItem[];
    more: DefaultNavItem[];
  };
  content: {
    rootPageId: string | null;
    homePageId: string | null;
    routeOverrides: Record<string, string> | null;
    sitemapExcludes: string[];
    sitemapAutoExclude: SitemapAutoExcludeConfig;
  };
};

export const DEFAULT_SITE_CONFIG: DefaultSiteConfig = {
  siteName: "Jinkun Chen.",
  lang: "en",
  seo: {
    title: "Jinkun Chen",
    description:
      "Jinkun Chen (he/him/his) — Ph.D. student studying Computer Science at Dalhousie University.",
    favicon: "/assets/favicon.png",
    ogImage: "/assets/profile.png",
    pageOverrides: {},
  },
  integrations: {
    googleAnalyticsId: "",
  },
  security: {
    contentGithubUsers: [],
  },
  memorial: {
    enabled: false,
    scope: "home",
    eyebrow: "In remembrance",
    title: "",
    context: "",
    englishTitle: "",
    message: "",
    chineseTitle: "",
    chineseMessage: "",
    sourceLabel: "Latest Updates",
    sourceUrl: "",
    sourceChineseLabel: "最新消息",
    sourceChineseUrl: "",
    startsAt: "",
    endsAt: "",
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
  content: {
    rootPageId: null,
    homePageId: null,
    routeOverrides: null,
    sitemapExcludes: [],
    sitemapAutoExclude: {
      enabled: true,
      excludeSections: [],
      maxDepthBySection: {
        teaching: 5,
      },
    },
  },
};
