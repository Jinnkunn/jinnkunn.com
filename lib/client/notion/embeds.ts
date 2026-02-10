export function initEmbeds(root: ParentNode) {
  // Super/Notion exports include an overlay loader for embeds. On the live site,
  // client scripts hide it after the iframe loads. In our static clone we need
  // to do this ourselves, otherwise embeds look "stuck loading".
  const embeds = Array.from(root.querySelectorAll<HTMLElement>(".notion-embed"));
  if (embeds.length === 0) return () => {};

  const cleanups: Array<() => void> = [];

  for (const embed of embeds) {
    const iframe = embed.querySelector<HTMLIFrameElement>("iframe");
    const loader = embed.querySelector<HTMLElement>(".notion-embed__loader");
    if (!iframe || !loader) continue;

    const markLoaded = () => {
      embed.setAttribute("data-loaded", "true");
      loader.style.display = "none";
    };

    // Some iframes may never fire `load` (blocked/slow). Prefer correctness, but
    // avoid permanently covering the content with the loader overlay.
    const fallbackTimer = window.setTimeout(() => {
      if (embed.getAttribute("data-loaded") === "true") return;
      markLoaded();
    }, 4500);

    iframe.addEventListener("load", markLoaded, { once: true });
    cleanups.push(() => {
      window.clearTimeout(fallbackTimer);
      iframe.removeEventListener("load", markLoaded);
    });
  }

  return () => {
    for (const fn of cleanups) fn();
  };
}

