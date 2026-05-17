export const SITE_ADMIN_IOS_CALLBACK_SCHEME = "jinnkunn-site-admin";
export const SITE_ADMIN_IOS_CALLBACK_HOST = "auth";
export const SITE_ADMIN_IOS_CALLBACK_PATH = "/callback";

export function parseSiteAdminAppRedirectUri(raw: string): URL | null {
  try {
    const target = new URL(String(raw || ""));

    if (target.protocol === "http:") {
      if (target.hostname !== "127.0.0.1" && target.hostname !== "localhost") {
        return null;
      }
      return target.port ? target : null;
    }

    if (target.protocol === `${SITE_ADMIN_IOS_CALLBACK_SCHEME}:`) {
      if (target.hostname !== SITE_ADMIN_IOS_CALLBACK_HOST) return null;
      if (target.pathname !== SITE_ADMIN_IOS_CALLBACK_PATH) return null;
      return target;
    }

    return null;
  } catch {
    return null;
  }
}
