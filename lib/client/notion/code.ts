type PrismModule = {
  highlightElement: (el: Element) => void;
};

function getLanguageFromCodeEl(codeEl: HTMLElement): string {
  for (const cls of Array.from(codeEl.classList)) {
    if (cls.startsWith("language-")) return cls.slice("language-".length).toLowerCase();
  }
  const pre = codeEl.closest("pre");
  if (pre) {
    for (const cls of Array.from(pre.classList)) {
      if (cls.startsWith("language-")) return cls.slice("language-".length).toLowerCase();
    }
  }
  return "";
}

function normalizePrismLanguage(raw: string): string | null {
  const l = String(raw || "").trim().toLowerCase();
  if (!l) return null;

  const alias: Record<string, string> = {
    // common
    plain: "plaintext",
    text: "plaintext",
    "plain text": "plaintext",
    "plain-text": "plaintext",
    plaintext: "plaintext",
    // shell
    shell: "bash",
    sh: "bash",
    zsh: "bash",
    // js/ts
    js: "javascript",
    ts: "typescript",
    jsx: "jsx",
    tsx: "tsx",
    // markdown
    md: "markdown",
    // misc
    yml: "yaml",
    py: "python",
  };

  return alias[l] || l;
}

const PRISM_LANGUAGE_LOADERS: Record<string, () => Promise<unknown>> = {
  // Base languages
  javascript: () => import("prismjs/components/prism-javascript"),
  typescript: () => import("prismjs/components/prism-typescript"),
  jsx: () => import("prismjs/components/prism-jsx"),
  tsx: () => import("prismjs/components/prism-tsx"),

  bash: () => import("prismjs/components/prism-bash"),
  python: () => import("prismjs/components/prism-python"),
  json: () => import("prismjs/components/prism-json"),
  yaml: () => import("prismjs/components/prism-yaml"),
  toml: () => import("prismjs/components/prism-toml"),
  sql: () => import("prismjs/components/prism-sql"),
  diff: () => import("prismjs/components/prism-diff"),

  // Markdown depends on markup + others; Prism will gracefully fall back if some are missing.
  markdown: () => import("prismjs/components/prism-markdown"),
};

export async function initCodeHighlighting(root: ParentNode) {
  const codeEls = Array.from(
    root.querySelectorAll<HTMLElement>("pre > code, pre > code[class*='language-']"),
  );

  const targets = codeEls.filter((codeEl) => {
    // Skip if it's already tokenized (e.g., raw Super exports).
    if (codeEl.querySelector(".token")) return false;

    const lang = normalizePrismLanguage(getLanguageFromCodeEl(codeEl));
    if (!lang) return false;
    if (lang === "plaintext") return false;
    return true;
  });

  if (targets.length === 0) return;

  let Prism: PrismModule | null = null;
  try {
    const mod = (await import("prismjs")) as unknown as PrismModule & {
      default?: PrismModule;
    };
    Prism = (mod.default || mod) as PrismModule;
  } catch {
    return;
  }

  try {
    // Some Prism language components expect a global `Prism` variable.
    (window as unknown as { Prism?: PrismModule }).Prism = Prism;
  } catch {
    // ignore
  }

  const langs = new Set<string>();
  for (const el of targets) {
    const lang = normalizePrismLanguage(getLanguageFromCodeEl(el));
    if (lang) langs.add(lang);
  }

  // Load requested languages (best-effort).
  for (const lang of langs) {
    const loader = PRISM_LANGUAGE_LOADERS[lang];
    if (!loader) continue;
    try {
      await loader();
    } catch {
      // ignore missing language components
    }
  }

  // Highlight after languages are registered.
  for (const el of targets) {
    try {
      Prism.highlightElement(el);
    } catch {
      // ignore per-block errors
    }
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  const t = (text ?? "").replace(/\s+$/, "");
  if (!t) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {
    // fall through to legacy execCommand
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

type CopyState = "idle" | "copied" | "failed";

const COPY_STATE_LABEL: Record<CopyState, string> = {
  idle: "",
  copied: "Copied",
  failed: "Failed",
};

function setCopyButtonState(btn: HTMLElement, state: CopyState) {
  // `data-copied` drives the only styled feedback this button has. It used to be a boolean,
  // so a failed clipboard write restored the idle label and looked exactly like never having
  // pressed the button at all.
  btn.setAttribute("data-copied", state === "idle" ? "false" : state);

  // Keep this robust against Notion/Super markup variations (sometimes text is a node).
  const original = btn.getAttribute("data-label") || "Copy";
  if (!btn.getAttribute("data-label")) btn.setAttribute("data-label", original);

  const desired = state === "idle" ? original : COPY_STATE_LABEL[state];
  // Update the last text node if present; otherwise append a span label.
  const nodes = Array.from(btn.childNodes);
  const lastText = [...nodes].reverse().find((n) => n.nodeType === Node.TEXT_NODE);
  if (lastText) {
    lastText.textContent = ` ${desired}`.replace(/^ /, "");
    return;
  }

  let label = btn.querySelector<HTMLElement>("[data-copy-label]");
  if (!label) {
    label = document.createElement("span");
    label.setAttribute("data-copy-label", "true");
    btn.appendChild(label);
  }
  label.textContent = desired;
}

const COPY_STATUS_ATTR = "data-copy-status";

function ensureCopyStatusRegion(codeRoot: Element): HTMLElement {
  const existing = codeRoot.querySelector<HTMLElement>(`[${COPY_STATUS_ATTR}]`);
  if (existing) return existing;

  // Deliberately a sibling of the button rather than a child of it: the button's label is a
  // bare text node (see components/posts-mdx/components.tsx), and live regions nested inside
  // an interactive element are announced inconsistently across screen readers.
  const region = document.createElement("span");
  region.className = "sr-only";
  region.setAttribute(COPY_STATUS_ATTR, "true");
  region.setAttribute("aria-live", "polite");
  codeRoot.appendChild(region);
  return region;
}

function announceCopyStatus(codeRoot: Element | null, message: string) {
  if (!codeRoot) return;
  const region = ensureCopyStatusRegion(codeRoot);
  // Blank first so a repeat of the same message still counts as a mutation, and defer the
  // write by a task so a region created during this very click is already in the DOM (live
  // regions do not announce the content they were inserted with).
  region.textContent = "";
  window.setTimeout(() => {
    region.textContent = message;
  }, 0);
}

export function shouldHandleCopyButtonClick(target: Element): HTMLElement | null {
  return target.closest<HTMLElement>(".notion-code__copy-button");
}

export async function handleCopyButtonClick(copyBtn: HTMLElement) {
  const codeRoot = copyBtn.closest(".notion-code");
  const codeEl = codeRoot?.querySelector("pre > code") ?? codeRoot?.querySelector("code");
  const text = (codeEl?.textContent ?? "").replace(/\n$/, "");

  const ok = await copyTextToClipboard(text);
  setCopyButtonState(copyBtn, ok ? "copied" : "failed");
  announceCopyStatus(
    codeRoot,
    ok ? "Code copied to clipboard" : "Copy failed. Select the code and copy manually.",
  );
  // Give the failure state longer on screen — it is the one the user has to act on.
  window.setTimeout(() => setCopyButtonState(copyBtn, "idle"), ok ? 1200 : 2400);
}

