function parseStyle(styleText: string): React.CSSProperties {
  // Convert "foo-bar:baz; --x:y" -> { fooBar: "baz", ["--x"]: "y" }.
  const out: Record<string, string> = {};
  for (const part of styleText.split(";")) {
    const p = part.trim();
    if (!p) continue;
    const idx = p.indexOf(":");
    if (idx === -1) continue;
    const key = p.slice(0, idx).trim();
    const value = p.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }

  const css: Record<string, string> = {};
  for (const [k, v] of Object.entries(out)) {
    if (k.startsWith("--")) {
      css[k] = v;
      continue;
    }
    const camel = k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    css[camel] = v;
  }
  return css as React.CSSProperties;
}

function parseAttrs(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // Supports key="v", key='v', key=v, and boolean attributes.
  const re =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrText))) {
    const key = m[1];
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    attrs[key] = value;
  }
  return attrs;
}

export default function RawHtml({ html }: { html: string }) {
  const m = html.match(/^\s*<main\b([^>]*)>([\s\S]*?)<\/main>\s*$/i);
  if (!m) {
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  }

  const attrText = m[1] ?? "";
  const inner = m[2] ?? "";
  const attrs = parseAttrs(attrText);

  const props: Record<string, unknown> = {
    dangerouslySetInnerHTML: { __html: inner },
  };

  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") {
      props.className = v;
    } else if (k === "style") {
      props.style = parseStyle(v);
    } else {
      props[k] = v;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <main {...(props as any)} />;
}
