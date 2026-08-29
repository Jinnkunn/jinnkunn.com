import type { MemorialConfig } from "@/lib/memorial";

function paragraphs(value: string) {
  return value
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function MemorialNotice({
  memorial,
  variant,
}: {
  memorial: MemorialConfig;
  variant: "compact" | "home";
}) {
  const englishSource = {
    label: memorial.sourceLabel.trim(),
    url: memorial.sourceUrl.trim(),
  };
  const chineseSource = {
    label: memorial.sourceChineseLabel.trim(),
    url: memorial.sourceChineseUrl.trim(),
  };
  const sources = [englishSource, chineseSource].filter(
    (source) => source.label && /^https:\/\//i.test(source.url),
  );
  const sourceLinks = sources.length ? (
    <div className="memorial-notice__sources" aria-label="Latest updates">
      {sources.map((source) => (
        <a key={source.url} href={source.url} rel="noreferrer" target="_blank">
          {source.label}
        </a>
      ))}
    </div>
  ) : null;
  if (variant === "compact") {
    return (
      <aside className="memorial-notice memorial-notice--compact" aria-label="Memorial notice">
        <div className="memorial-notice__inner memorial-notice__inner--compact">
          <span className="memorial-notice__marker" aria-hidden="true" />
          <div className="memorial-notice__compact-copy">
            {memorial.eyebrow ? (
              <p className="memorial-notice__eyebrow">{memorial.eyebrow}</p>
            ) : null}
            <p className="memorial-notice__compact-title">
              <span>{memorial.title}</span>
              {memorial.context ? (
                <span className="memorial-notice__compact-context" lang="en">
                  {memorial.context}
                </span>
              ) : null}
            </p>
          </div>
          {sourceLinks}
        </div>
      </aside>
    );
  }

  return (
    <section className="memorial-notice memorial-notice--home" aria-labelledby="memorial-title">
      <div className="memorial-notice__inner memorial-notice__inner--home">
        {memorial.eyebrow ? <p className="memorial-notice__eyebrow">{memorial.eyebrow}</p> : null}
        <div className="memorial-notice__layout">
          <div className="memorial-notice__primary" lang="en">
            <h2 id="memorial-title">{memorial.context || memorial.title}</h2>
            {memorial.englishTitle ? <h3>{memorial.englishTitle}</h3> : null}
            {paragraphs(memorial.message).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {englishSource.label && /^https:\/\//i.test(englishSource.url) ? (
              <a
                className="memorial-notice__column-source"
                href={englishSource.url}
                rel="noreferrer"
                target="_blank"
              >
                {englishSource.label}
              </a>
            ) : null}
          </div>
          <div className="memorial-notice__secondary" lang="zh-Hans">
            {memorial.context ? (
              <p className="memorial-notice__secondary-location">{memorial.title}</p>
            ) : null}
            {memorial.chineseTitle ? <h3>{memorial.chineseTitle}</h3> : null}
            {paragraphs(memorial.chineseMessage).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {chineseSource.label && /^https:\/\//i.test(chineseSource.url) ? (
              <a
                className="memorial-notice__column-source"
                href={chineseSource.url}
                rel="noreferrer"
                target="_blank"
              >
                {chineseSource.label}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
