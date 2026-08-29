"use client";

import { useId, useState } from "react";
import { usePathname } from "next/navigation";

import type { MemorialConfig } from "@/lib/memorial";

function paragraphs(value: string) {
  return value
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function MemorialNotice({
  memorial,
}: {
  memorial: MemorialConfig;
}) {
  const pathname = usePathname();
  const contentId = useId();
  const isHome = pathname === "/";
  const [userPreference, setUserPreference] = useState<boolean | null>(null);
  const expanded = userPreference ?? isHome;
  const englishSource = {
    label: memorial.sourceLabel.trim(),
    url: memorial.sourceUrl.trim(),
  };
  const chineseSource = {
    label: memorial.sourceChineseLabel.trim(),
    url: memorial.sourceChineseUrl.trim(),
  };
  const hasEnglishSource = englishSource.label && /^https:\/\//i.test(englishSource.url);
  const hasChineseSource = chineseSource.label && /^https:\/\//i.test(chineseSource.url);
  const toggleLabel = expanded ? "Collapse memorial message" : "Expand memorial message";

  if (memorial.scope === "home" && !isHome) return null;

  if (!expanded) {
    return (
      <aside
        className="memorial-notice memorial-notice--compact"
        aria-label="Memorial notice"
        data-expanded="false"
      >
        <div className="memorial-notice__inner memorial-notice__inner--compact">
          <span className="memorial-notice__marker" aria-hidden="true" />
          <div className="memorial-notice__compact-copy" id={contentId}>
            {memorial.eyebrow ? (
              <p className="memorial-notice__eyebrow">{memorial.eyebrow}</p>
            ) : null}
            <p className="memorial-notice__compact-title">
              {memorial.context ? <span lang="en">{memorial.context}</span> : null}
              {memorial.context && memorial.title ? (
                <span className="memorial-notice__compact-divider" aria-hidden="true">
                  /
                </span>
              ) : null}
              {memorial.title ? <span lang="zh-Hans">{memorial.title}</span> : null}
            </p>
            {hasEnglishSource || hasChineseSource ? (
              <div className="memorial-notice__compact-sources" aria-label="Latest updates">
                {hasEnglishSource ? (
                  <a
                    className="memorial-notice__compact-source"
                    href={englishSource.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {englishSource.label}
                  </a>
                ) : null}
                {hasChineseSource ? (
                  <a
                    className="memorial-notice__compact-source"
                    href={chineseSource.url}
                    rel="noreferrer"
                    target="_blank"
                    lang="zh-Hans"
                  >
                    {chineseSource.label}
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="memorial-notice__toggle"
            aria-controls={contentId}
            aria-expanded="false"
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={() => setUserPreference(true)}
          >
            <span className="memorial-notice__toggle-icon" aria-hidden="true" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <section
      className="memorial-notice memorial-notice--home"
      aria-labelledby="memorial-title"
      data-expanded="true"
    >
      <div className="memorial-notice__inner memorial-notice__inner--home">
        <div className="memorial-notice__header">
          {memorial.eyebrow ? <p className="memorial-notice__eyebrow">{memorial.eyebrow}</p> : null}
          <button
            type="button"
            className="memorial-notice__toggle"
            aria-controls={contentId}
            aria-expanded="true"
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={() => setUserPreference(false)}
          >
            <span className="memorial-notice__toggle-icon" aria-hidden="true" />
          </button>
        </div>
        <div className="memorial-notice__layout" id={contentId}>
          <div className="memorial-notice__primary" lang="en">
            <h2 id="memorial-title">{memorial.context || memorial.title}</h2>
            {memorial.englishTitle ? <h3>{memorial.englishTitle}</h3> : null}
            {paragraphs(memorial.message).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {hasEnglishSource ? (
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
            {hasChineseSource ? (
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
