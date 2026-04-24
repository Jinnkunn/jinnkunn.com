import type { SiteAdminStructuredPageSection } from "@/lib/site-admin/api-types";

export function structuredPageSectionClassName(
  section: SiteAdminStructuredPageSection,
): string {
  return `structured-page-section structured-page-section--${section.width}`;
}
