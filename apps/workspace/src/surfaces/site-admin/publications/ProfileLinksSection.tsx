import type { PublicationProfileLink } from "../types";

export interface ProfileLinksSectionProps {
  links: PublicationProfileLink[];
  onChange: (next: PublicationProfileLink[]) => void;
}

function deriveHostname(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function ProfileLinksSection({ links, onChange }: ProfileLinksSectionProps) {
  const updateField = <K extends keyof PublicationProfileLink>(
    index: number,
    key: K,
    value: PublicationProfileLink[K],
  ) => {
    onChange(
      links.map((link, i) => {
        if (i !== index) return link;
        const next = { ...link, [key]: value };
        if (key === "href" && typeof value === "string") {
          next.hostname = deriveHostname(value);
        }
        return next;
      }),
    );
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= links.length) return;
    const next = links.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const remove = (index: number) =>
    onChange(links.filter((_, i) => i !== index));

  const add = () =>
    onChange([...links, { label: "", href: "", hostname: "" }]);

  return (
    <details className="surface-details" open>
      <summary>Profile Links</summary>
      <div className="flex flex-col gap-2 mt-1">
        {links.length === 0 ? (
          <p className="empty-note">No profile links. Add the usual suspects (Google Scholar, ORCID…).</p>
        ) : (
          <>
            <div className="grid-row grid-header pubs-profile-row">
              <span>Label</span>
              <span>URL</span>
              <span>Actions</span>
            </div>
            {links.map((link, index) => (
              <div className="grid-row pubs-profile-row" key={index}>
                <input
                  value={link.label}
                  placeholder="Google Scholar"
                  onChange={(e) => updateField(index, "label", e.target.value)}
                />
                <input
                  value={link.href}
                  placeholder="https://scholar.google.com/..."
                  onChange={(e) => updateField(index, "href", e.target.value)}
                  spellCheck={false}
                />
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ padding: "3px 8px", fontSize: 11 }}
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ padding: "3px 8px", fontSize: 11 }}
                    onClick={() => move(index, 1)}
                    disabled={index === links.length - 1}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ padding: "3px 8px", fontSize: 11, color: "var(--color-danger)" }}
                    onClick={() => remove(index)}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="flex gap-2 pt-2">
        <button className="btn btn--secondary" type="button" onClick={add}>
          + Add profile link
        </button>
      </div>
    </details>
  );
}
