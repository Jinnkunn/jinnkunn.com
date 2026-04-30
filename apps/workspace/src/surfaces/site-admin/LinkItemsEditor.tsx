import type { MdxLinkItem } from "./mdx-blocks";

export type LinkItemsEditorVariant = "canvas" | "inspector";

export interface LinkItemsEditorProps {
  addLabel?: string;
  disabled?: boolean;
  emptyLabel: string;
  featured?: boolean;
  items: MdxLinkItem[];
  onChange: (items: MdxLinkItem[]) => void;
  variant?: LinkItemsEditorVariant;
  withDescription?: boolean;
  withHostname?: boolean;
}

export function makeEmptyLinkItem(): MdxLinkItem {
  return { label: "", href: "" };
}

export function patchLinkItem(
  items: MdxLinkItem[] | undefined,
  index: number,
  patch: Partial<MdxLinkItem>,
): MdxLinkItem[] {
  const next = items ? items.slice() : [];
  if (index < 0 || index >= next.length) return next;
  next[index] = { ...next[index], ...patch };
  return next;
}

function hostLabel(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url, "https://jinkunchen.com").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function LinkItemsEditor({
  addLabel = "+ Add link",
  disabled = false,
  emptyLabel,
  featured = false,
  items,
  onChange,
  variant = "canvas",
  withDescription = false,
  withHostname = false,
}: LinkItemsEditorProps) {
  const addItem = () => onChange([...items, makeEmptyLinkItem()]);
  const removeItem = (index: number) => onChange(items.filter((_, i) => i !== index));
  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = items.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const updateItem = (index: number, patch: Partial<MdxLinkItem>) => {
    onChange(patchLinkItem(items, index, patch));
  };

  if (variant === "inspector") {
    return (
      <div className="mdx-block-inspector__items">
        {items.length === 0 ? (
          <p className="mdx-block-inspector__hint">{emptyLabel}</p>
        ) : (
          items.map((item, index) => (
            <div className="mdx-block-inspector__item" key={index}>
              <label className="mdx-block-inspector__field">
                <span>Label</span>
                <input
                  disabled={disabled}
                  value={item.label}
                  placeholder="Link label"
                  onChange={(event) => updateItem(index, { label: event.target.value })}
                />
              </label>
              <label className="mdx-block-inspector__field">
                <span>URL</span>
                <input
                  disabled={disabled}
                  value={item.href}
                  placeholder="/path or https://"
                  onChange={(event) => updateItem(index, { href: event.target.value })}
                />
              </label>
              {withHostname ? (
                <label className="mdx-block-inspector__field">
                  <span>Hostname</span>
                  <input
                    disabled={disabled}
                    value={item.hostname ?? ""}
                    placeholder={hostLabel(item.href) || "example.com"}
                    onChange={(event) =>
                      updateItem(index, { hostname: event.target.value || undefined })
                    }
                  />
                </label>
              ) : null}
              {featured || withDescription ? (
                <label className="mdx-block-inspector__field">
                  <span>Description</span>
                  <input
                    disabled={disabled}
                    value={item.description ?? ""}
                    placeholder="Optional card text"
                    onChange={(event) =>
                      updateItem(index, { description: event.target.value || undefined })
                    }
                  />
                </label>
              ) : null}
              <div className="mdx-block-inspector__item-actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={disabled || index === 0}
                  onClick={() => moveItem(index, -1)}
                >
                  Up
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={disabled || index === items.length - 1}
                  onClick={() => moveItem(index, 1)}
                >
                  Down
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={disabled}
                  onClick={() => removeItem(index)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))
        )}
        <button
          type="button"
          className="btn btn--secondary"
          disabled={disabled}
          onClick={addItem}
        >
          {addLabel}
        </button>
      </div>
    );
  }

  return (
    <>
      <ul className="mdx-document-link-list-block__items" role="list">
        {items.length === 0 ? (
          <li className="mdx-document-link-list-block__empty">
            {emptyLabel}
          </li>
        ) : (
          items.map((item, index) => (
            <li
              key={index}
              className={`mdx-document-link-list-block__item mdx-document-link-list-block__item--editable${
                featured ? " mdx-document-link-list-block__item--featured" : ""
              }`}
            >
              <label>
                <span>Label</span>
                <input
                  disabled={disabled}
                  value={item.label}
                  placeholder={item.href || `Link ${index + 1}`}
                  onChange={(event) => updateItem(index, { label: event.target.value })}
                />
              </label>
              <label>
                <span>URL</span>
                <input
                  disabled={disabled}
                  value={item.href}
                  placeholder="https://... or /page"
                  onChange={(event) => updateItem(index, { href: event.target.value })}
                />
              </label>
              {withDescription ? (
                <label className="mdx-document-link-list-block__field--wide">
                  <span>Description</span>
                  <textarea
                    disabled={disabled}
                    rows={2}
                    value={item.description ?? ""}
                    placeholder="Short card description"
                    onChange={(event) =>
                      updateItem(index, { description: event.target.value || undefined })
                    }
                  />
                </label>
              ) : null}
              {withHostname ? (
                <label>
                  <span>Hostname</span>
                  <input
                    disabled={disabled}
                    value={item.hostname ?? ""}
                    placeholder={hostLabel(item.href) || "example.com"}
                    onChange={(event) =>
                      updateItem(index, { hostname: event.target.value || undefined })
                    }
                  />
                </label>
              ) : null}
              <button
                type="button"
                className="mdx-document-link-list-block__remove"
                disabled={disabled}
                onClick={() => removeItem(index)}
                aria-label={`Remove link ${index + 1}`}
              >
                ×
              </button>
            </li>
          ))
        )}
      </ul>
      <button
        type="button"
        className="mdx-document-link-list-block__add"
        disabled={disabled}
        onClick={addItem}
      >
        {addLabel}
      </button>
    </>
  );
}
