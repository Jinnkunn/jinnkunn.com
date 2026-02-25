function setElementVisibilityState(el: HTMLElement, hidden: boolean): void {
  const keyVis = "mobileMenuPrevVisibility";
  const keyPtr = "mobileMenuPrevPointerEvents";
  const keyAria = "mobileMenuPrevAriaHidden";

  if (hidden) {
    if (!(keyVis in el.dataset)) el.dataset[keyVis] = el.style.visibility || "__EMPTY__";
    if (!(keyPtr in el.dataset)) el.dataset[keyPtr] = el.style.pointerEvents || "__EMPTY__";
    if (!(keyAria in el.dataset)) el.dataset[keyAria] = el.getAttribute("aria-hidden") ?? "__NULL__";
    el.style.setProperty("visibility", "hidden", "important");
    el.style.setProperty("pointer-events", "none", "important");
    el.setAttribute("aria-hidden", "true");
    return;
  }

  const prevVis = el.dataset[keyVis];
  const prevPtr = el.dataset[keyPtr];
  const prevAria = el.dataset[keyAria];
  if (prevVis === "__EMPTY__" || prevVis == null) el.style.removeProperty("visibility");
  else el.style.setProperty("visibility", prevVis);
  if (prevPtr === "__EMPTY__" || prevPtr == null) el.style.removeProperty("pointer-events");
  else el.style.setProperty("pointer-events", prevPtr);
  if (prevAria === "__NULL__" || prevAria == null) el.removeAttribute("aria-hidden");
  else el.setAttribute("aria-hidden", prevAria);
  delete el.dataset[keyVis];
  delete el.dataset[keyPtr];
  delete el.dataset[keyAria];
}

function setMobileLayerIsolation(open: boolean): void {
  const targets = Array.from(
    document.querySelectorAll<HTMLElement>(".super-content-wrapper, footer.super-footer"),
  );
  for (const target of targets) setElementVisibilityState(target, open);
}

export function setMobilePageState(open: boolean): void {
  const root = document.documentElement;
  root.classList.toggle("mobile-menu-open", open);
  root.dataset.mobileMenuOpen = open ? "1" : "0";
  setMobileLayerIsolation(open);
}

export function applyMobileMenuOpenLayout(menu: HTMLElement): void {
  menu.style.position = "fixed";
  menu.style.inset = "0";
  menu.style.top = "0";
  menu.style.left = "0";
  menu.style.right = "0";
  menu.style.bottom = "0";
  menu.style.width = "100vw";
  menu.style.minWidth = "100vw";
  menu.style.height = "100svh";
  menu.style.minHeight = "100svh";
  menu.style.maxHeight = "none";
  menu.style.boxSizing = "border-box";
  menu.style.zIndex = "6000";
  menu.style.display = "flex";
  menu.style.alignItems = "stretch";
  menu.style.justifyContent = "flex-end";
  menu.style.overflow = "hidden";
  menu.style.pointerEvents = "auto";
  menu.style.touchAction = "auto";
  menu.style.background = "var(--mobile-menu-bg, #f5f2eb)";
}

export function playMobileMenuEnter(menu: HTMLElement): void {
  menu.classList.remove("exit", "exit-active");
  menu.classList.add("enter");
  requestAnimationFrame(() => {
    menu.classList.remove("enter");
    menu.classList.add("enter-done");
  });
}

export function hideMobileMenuImmediately(menu: HTMLElement): void {
  menu.hidden = true;
  menu.style.display = "none";
  menu.classList.remove("enter", "enter-active", "enter-done");
  menu.classList.remove("exit", "exit-active");
}

export function playMobileMenuExit(menu: HTMLElement, onDone: () => void): number {
  menu.classList.remove("enter", "enter-active", "enter-done");
  menu.classList.add("exit");
  requestAnimationFrame(() => {
    menu.classList.add("exit-active");
  });
  return window.setTimeout(() => {
    onDone();
    menu.classList.remove("exit", "exit-active");
  }, 280);
}

function syncMoreMenuHeight(menu: HTMLElement): void {
  const content = menu.querySelector<HTMLElement>(".super-navbar__list-content");
  if (!content) return;
  const rect = content.getBoundingClientRect();
  const h = Math.max(0, Math.ceil(rect.height));
  menu.style.setProperty("--radix-navigation-menu-viewport-height", `${h}px`);
}

export function attachMoreMenuHeightObserver(
  menu: HTMLElement,
  prevObserver: ResizeObserver | null,
): ResizeObserver | null {
  prevObserver?.disconnect();
  syncMoreMenuHeight(menu);
  const content = menu.querySelector<HTMLElement>(".super-navbar__list-content");
  if (!content || typeof ResizeObserver === "undefined") return null;
  const observer = new ResizeObserver(() => syncMoreMenuHeight(menu));
  observer.observe(content);
  return observer;
}
