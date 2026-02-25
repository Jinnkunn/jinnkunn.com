import type { MoreFocusTarget } from "./menu-focus";

type FocusTrapController = {
  onKeyDown: (e: KeyboardEvent) => void;
  onFocusIn: (e: FocusEvent) => void;
};

type CreateMenuEventHandlersArgs = {
  nav: HTMLElement;
  moreBtn: HTMLElement;
  moreMenu: HTMLElement;
  mobileBtn: HTMLElement;
  mobileDialog: HTMLElement;
  mobileTrap: FocusTrapController;
  getMoreOpen: () => boolean;
  getMobileOpen: () => boolean;
  getMobilePrevFocus: () => HTMLElement | null;
  getMoreItems: () => HTMLElement[];
  focusMoreItem: (which: MoreFocusTarget) => void;
  setMoreOpen: (open: boolean, opts?: { focus?: "first" | "last" }) => void;
  setMobileOpen: (open: boolean, opts?: { restoreFocus?: boolean }) => void;
  closeAll: () => void;
};

type MoreHoverHandlers = {
  onMorePointerEnter: () => void;
  onMorePointerLeave: () => void;
  clearMoreHoverClose: () => void;
};

function createMoreHoverHandlers(opts: {
  canHover: boolean;
  setMoreOpen: (open: boolean) => void;
}): MoreHoverHandlers {
  let timer: number | null = null;

  const clearMoreHoverClose = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
  };

  const scheduleClose = () => {
    if (!opts.canHover) return;
    clearMoreHoverClose();
    timer = window.setTimeout(() => {
      opts.setMoreOpen(false);
    }, 120);
  };

  const onMorePointerEnter = () => {
    if (!opts.canHover) return;
    clearMoreHoverClose();
    opts.setMoreOpen(true);
  };

  const onMorePointerLeave = () => {
    if (!opts.canHover) return;
    scheduleClose();
  };

  return {
    onMorePointerEnter,
    onMorePointerLeave,
    clearMoreHoverClose,
  };
}

export function createMenuEventHandlers({
  nav,
  moreBtn,
  moreMenu,
  mobileBtn,
  mobileDialog,
  mobileTrap,
  getMoreOpen,
  getMobileOpen,
  getMobilePrevFocus,
  getMoreItems,
  focusMoreItem,
  setMoreOpen,
  setMobileOpen,
  closeAll,
}: CreateMenuEventHandlersArgs) {
  const onPointerDown = (e: PointerEvent) => {
    const t = e.target instanceof Node ? e.target : null;
    if (!t) {
      closeAll();
      return;
    }

    if (getMobileOpen()) {
      if (mobileBtn.contains(t) || mobileDialog.contains(t)) return;
      setMobileOpen(false, { restoreFocus: true });
      return;
    }

    if (getMoreOpen()) {
      if (moreBtn.contains(t) || moreMenu.contains(t)) return;
      setMoreOpen(false);
      return;
    }

    if (nav.contains(t)) return;
    closeAll();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Tab" && getMobileOpen()) {
      mobileTrap.onKeyDown(e);
      return;
    }
    if (e.key !== "Escape") return;
    e.preventDefault();
    const focusMore = getMoreOpen();
    const focusMobile = getMobileOpen();
    closeAll();
    if (focusMobile) (getMobilePrevFocus() ?? mobileBtn).focus();
    else if (focusMore) moreBtn.focus();
  };

  const onFocusIn = (e: FocusEvent) => {
    if (!getMobileOpen()) return;
    mobileTrap.onFocusIn(e);
  };

  const onNavClickCapture = (e: MouseEvent) => {
    const t = e.target instanceof Element ? e.target : null;
    const a = t?.closest("a");
    if (!a) return;
    closeAll();
  };

  const onMoreClick = (e: MouseEvent) => {
    e.preventDefault();
    setMoreOpen(!getMoreOpen());
  };

  const onMoreTriggerKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMoreOpen(true, { focus: "first" });
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setMoreOpen(true, { focus: "last" });
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const next = !getMoreOpen();
      setMoreOpen(next, next ? { focus: "first" } : {});
      return;
    }
    if (e.key === "Escape" && getMoreOpen()) {
      e.preventDefault();
      setMoreOpen(false);
    }
  };

  const onMoreMenuKeyDown = (e: KeyboardEvent) => {
    if (!getMoreOpen()) return;

    if (e.key === "Escape") {
      e.preventDefault();
      setMoreOpen(false);
      moreBtn.focus();
      return;
    }

    if (e.key === "Tab") {
      setMoreOpen(false);
      return;
    }

    const items = getMoreItems();
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const idx = Math.max(0, items.findIndex((el) => el === active));

    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusMoreItem(idx + 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      focusMoreItem(idx - 1);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      focusMoreItem("first");
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      focusMoreItem("last");
    }
  };

  const onMobileClick = (e: MouseEvent) => {
    e.preventDefault();
    setMobileOpen(!getMobileOpen());
  };

  const onBackdropClick = (e: MouseEvent) => {
    e.preventDefault();
    setMobileOpen(false, { restoreFocus: true });
  };

  const onCloseBtnClick = (e: MouseEvent) => {
    e.preventDefault();
    setMobileOpen(false, { restoreFocus: true });
  };

  const canHover =
    typeof window !== "undefined" &&
    window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches;
  const hover = createMoreHoverHandlers({
    canHover,
    setMoreOpen: (open) => setMoreOpen(open),
  });

  return {
    onPointerDown,
    onKeyDown,
    onFocusIn,
    onNavClickCapture,
    onMoreClick,
    onMoreTriggerKeyDown,
    onMoreMenuKeyDown,
    onMobileClick,
    onBackdropClick,
    onCloseBtnClick,
    onMorePointerEnter: hover.onMorePointerEnter,
    onMorePointerLeave: hover.onMorePointerLeave,
    clearMoreHoverClose: hover.clearMoreHoverClose,
  };
}
