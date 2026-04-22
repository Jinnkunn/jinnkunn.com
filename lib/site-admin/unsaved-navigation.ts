export function shouldBlockUnsavedNavigation(input: {
  enabled: boolean;
  currentHref: string;
  nextHref: string;
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: string | null;
  download?: boolean;
}): boolean {
  if (!input.enabled) return false;
  if ((input.button ?? 0) !== 0) return false;
  if (input.metaKey || input.ctrlKey || input.shiftKey || input.altKey) return false;
  if (input.download) return false;

  const target = String(input.target || "").trim().toLowerCase();
  if (target && target !== "_self") return false;

  try {
    const currentUrl = new URL(input.currentHref);
    const nextUrl = new URL(input.nextHref, currentUrl);
    if (currentUrl.origin !== nextUrl.origin) return false;
    return (
      currentUrl.pathname !== nextUrl.pathname ||
      currentUrl.search !== nextUrl.search ||
      currentUrl.hash !== nextUrl.hash
    );
  } catch {
    return false;
  }
}
