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
  };
  integrations: {
    googleAnalyticsId: string;
  };
  security: {
    contentGithubUsers: string[];
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
  },
  integrations: {
    googleAnalyticsId: "",
  },
  security: {
    contentGithubUsers: [],
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
  },
};
