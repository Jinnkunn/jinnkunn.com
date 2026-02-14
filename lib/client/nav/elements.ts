export type SiteNavElements = {
  nav: HTMLElement;
  moreBtn: HTMLButtonElement;
  moreMenu: HTMLElement;
  mobileBtn: HTMLButtonElement;
  mobileMenu: HTMLElement;
  mobileBackdrop: HTMLButtonElement;
  mobileClose: HTMLButtonElement;
  mobileDialog: HTMLElement;
};

export function getSiteNavElements(): SiteNavElements | null {
  const nav = document.getElementById("site-nav");
  if (!nav) return null;

  const moreBtn = document.getElementById("more-trigger") as HTMLButtonElement | null;
  const moreMenu = document.getElementById("more-menu") as HTMLElement | null;
  const mobileBtn = document.getElementById("mobile-trigger") as HTMLButtonElement | null;
  const mobileMenu = document.getElementById("mobile-menu") as HTMLElement | null;
  const mobileBackdrop = document.getElementById("mobile-backdrop") as HTMLButtonElement | null;
  const mobileClose = document.getElementById("mobile-close") as HTMLButtonElement | null;
  const mobileDialog = mobileMenu?.querySelector(".super-navbar__menu") as HTMLElement | null;

  if (
    !moreBtn ||
    !moreMenu ||
    !mobileBtn ||
    !mobileMenu ||
    !mobileBackdrop ||
    !mobileClose ||
    !mobileDialog
  ) {
    return null;
  }

  return {
    nav,
    moreBtn,
    moreMenu,
    mobileBtn,
    mobileMenu,
    mobileBackdrop,
    mobileClose,
    mobileDialog,
  };
}
