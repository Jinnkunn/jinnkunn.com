import type { SiteAdminHomeData } from "./api-types";

const EMPTY_DATA: SiteAdminHomeData = {
  title: "Hi there!",
  body: "",
};

export function normalizeHomeData(raw: unknown): SiteAdminHomeData {
  if (!raw || typeof raw !== "object") return { ...EMPTY_DATA };
  const r = raw as Record<string, unknown>;
  const data: SiteAdminHomeData = {
    title:
      typeof r.title === "string" && r.title.trim() ? r.title : EMPTY_DATA.title,
    body: typeof r.body === "string" ? r.body : "",
  };
  if (typeof r.profileImageUrl === "string" && r.profileImageUrl.trim()) {
    data.profileImageUrl = r.profileImageUrl;
  }
  if (typeof r.profileImageAlt === "string" && r.profileImageAlt.trim()) {
    data.profileImageAlt = r.profileImageAlt;
  }
  return data;
}

export function emptyHomeData(): SiteAdminHomeData {
  return { ...EMPTY_DATA };
}
