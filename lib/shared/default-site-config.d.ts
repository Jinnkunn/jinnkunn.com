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
  };
};

export const DEFAULT_SITE_CONFIG: DefaultSiteConfig;

