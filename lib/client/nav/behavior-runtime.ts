import { refreshSiteNavActiveLinks } from "./active-links";
import { getSiteNavElements } from "./elements";
import { setupSiteNavMenuBehavior } from "./menu-controller";

export { refreshSiteNavActiveLinks };

export function setupSiteNavBehavior(): () => void {
  const elements = getSiteNavElements();
  if (!elements) return () => {};
  return setupSiteNavMenuBehavior(elements);
}
