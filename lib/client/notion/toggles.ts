function isProbablyInteractiveToggleTarget(el: Element): boolean {
  // Avoid toggling when clicking an actual link inside the summary.
  return !Boolean(el.closest("a[href]"));
}

export function setToggleState(toggle: HTMLElement, open: boolean) {
  toggle.classList.toggle("open", open);
  toggle.classList.toggle("closed", !open);

  const summary = toggle.querySelector<HTMLElement>(".notion-toggle__summary");
  if (summary) {
    summary.setAttribute("role", "button");
    summary.tabIndex = 0;
    summary.setAttribute("aria-expanded", open ? "true" : "false");
  }

  const content = toggle.querySelector<HTMLElement>(".notion-toggle__content");
  if (content) {
    content.hidden = !open;
    content.setAttribute("aria-hidden", open ? "false" : "true");
  }
}

export function initToggles(root: ParentNode) {
  const toggles = Array.from(root.querySelectorAll<HTMLElement>(".notion-toggle"));
  for (const t of toggles) {
    // Tag toggle "kind" based on its visible label, so CSS can apply typography
    // standards to special sections (e.g., references/footnotes) without relying
    // on unstable block IDs.
    const summary = t.querySelector<HTMLElement>(".notion-toggle__summary");
    const label =
      summary?.querySelector(".notion-semantic-string")?.textContent ??
      summary?.textContent ??
      "";
    const normalized = label.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized) {
      if (
        /(^|[\s:])(reference|references|bibliography|citations)([\s:]|$)/i.test(
          normalized,
        ) ||
        /参考文献/.test(label)
      ) {
        t.setAttribute("data-toggle-kind", "references");
      }
    }

    const open = t.classList.contains("open") || !t.classList.contains("closed");
    // If content exists, reflect state via `hidden` for a11y (CSS still controls layout).
    setToggleState(t, open);
  }
}

export function decodeHashToId(hash: string): string | null {
  const h = (hash ?? "").trim();
  if (!h || !h.startsWith("#") || h.length < 2) return null;
  const raw = h.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    // If it's not valid URI encoding, still try the raw string.
    return raw;
  }
}

export function openToggleAncestors(target: Element) {
  // Works for markup where toggle children are nested under `.notion-toggle__content`.
  // (Some Super exports don't nest children; in that case there is nothing reliable to open.)
  const toggles: HTMLElement[] = [];
  let cur: Element | null = target;
  while (cur) {
    const t = cur.closest(".notion-toggle.closed") as HTMLElement | null;
    if (!t) break;
    toggles.push(t);
    cur = t.parentElement;
  }

  // Open outer -> inner to avoid hiding inner content behind a closed parent.
  toggles.reverse();
  for (const t of toggles) setToggleState(t, true);
}

export function toggleFromSummaryInteraction(summary: Element, target: Element): boolean {
  if (!isProbablyInteractiveToggleTarget(target)) return false;
  const toggle = summary.closest<HTMLElement>(".notion-toggle");
  if (!toggle) return false;
  const open = toggle.classList.contains("closed");
  setToggleState(toggle, open);
  return true;
}

