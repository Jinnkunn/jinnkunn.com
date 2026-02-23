// Shared default site config used by build scripts and the Next.js runtime.
// Keep this file ESM + dependency-free so Node can import it directly.

export const DEFAULT_SITE_CONFIG = {
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
    // GitHub logins (no @), used for GitHub-protected content pages.
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
    rootPageId: null, // defaults to NOTION_SITE_ADMIN_PAGE_ID
    homePageId: null, // defaults to a child page titled "Home"/"Index" (or the first child page)
    // Optional: map Notion page id -> route path (e.g. { "<pageId>": "/chen" }).
    routeOverrides: null,
    // Optional: route paths or page ids to exclude from sitemap.
    sitemapExcludes: [],
  },
};
