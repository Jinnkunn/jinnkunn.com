export type SiteSettings = {
  rowId: string;
  siteName: string;
  lang: string;
  seoTitle: string;
  seoDescription: string;
  favicon: string;
  ogImage: string;
  seoPageOverrides: string;
  googleAnalyticsId: string;
  contentGithubUsers: string;
  sitemapExcludes: string;
  sitemapAutoExcludeEnabled: boolean;
  sitemapAutoExcludeSections: string;
  sitemapAutoExcludeDepthPages: string;
  sitemapAutoExcludeDepthBlog: string;
  sitemapAutoExcludeDepthPublications: string;
  sitemapAutoExcludeDepthTeaching: string;
  rootPageId: string;
  homePageId: string;
};

export type NavItemRow = {
  rowId: string;
  label: string;
  href: string;
  group: "top" | "more";
  order: number;
  enabled: boolean;
};
