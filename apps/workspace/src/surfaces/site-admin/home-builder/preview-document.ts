function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function stylesheetLinks(stylesheets: string[]): string {
  const fallbacks = [
    "/styles/super-inline.css",
    "/styles/static.css",
    "/styles/notion.css",
    "/styles/super.css",
    "/styles/super-nav.css",
  ];
  const hrefs = stylesheets.length > 0 ? stylesheets : fallbacks;
  return hrefs
    .map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}" />`)
    .join("\n  ");
}

export function buildHomePreviewDocument(
  html: string,
  baseUrl: string,
  stylesheets: string[] = [],
): string {
  const base = escapeAttr(baseUrl || "http://localhost:3000");
  return `<!doctype html>
<html lang="en" data-theme="light" class="theme-light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="${base}/" />
  ${stylesheetLinks(stylesheets)}
  <style>
    body { margin: 0; background: #fff; }
    .super-content-wrapper { min-height: auto; }
    .super-content { padding-top: 0 !important; }
    .notion-root.max-width, .notion-header__content.max-width { max-width: 860px; }
    [data-home-section-id] {
      border-radius: 10px;
      cursor: pointer;
      outline: 2px solid transparent;
      outline-offset: 6px;
      transition: outline-color 120ms ease, background-color 120ms ease;
    }
    [data-home-section-id]:hover {
      outline-color: rgba(36, 107, 253, 0.28);
    }
    [data-home-section-id].home-preview-selected {
      outline-color: rgba(36, 107, 253, 0.76);
      background: rgba(36, 107, 253, 0.045);
    }
  </style>
</head>
<body>
  <div class="super-root">
    <div id="main-content" class="super-content-wrapper">${html}</div>
  </div>
  <script>
    (function () {
      function closestSection(target) {
        return target && target.closest ? target.closest("[data-home-section-id]") : null;
      }
      document.addEventListener("click", function (event) {
        var section = closestSection(event.target);
        if (!section) return;
        event.preventDefault();
        window.parent.postMessage(
          { type: "site-admin:home-section-select", id: section.getAttribute("data-home-section-id") },
          "*"
        );
      });
      window.addEventListener("message", function (event) {
        var data = event.data || {};
        if (data.type !== "site-admin:home-section-highlight") return;
        document.querySelectorAll("[data-home-section-id]").forEach(function (section) {
          section.classList.toggle(
            "home-preview-selected",
            section.getAttribute("data-home-section-id") === data.id
          );
        });
      });
    })();
  </script>
</body>
</html>`;
}
