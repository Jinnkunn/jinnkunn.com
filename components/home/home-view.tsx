import "server-only";

import Image from "next/image";
import type { ReactElement } from "react";

import { ClassicLink } from "@/components/classic/classic-link";
import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import { renderSimpleClassicMarkdown } from "@/components/classic/markdown";
import type {
  SiteAdminHomeData,
  SiteAdminHomeLayoutBlock,
  SiteAdminHomeLayoutSection,
  SiteAdminHomeLink,
  SiteAdminHomeSection,
} from "@/lib/site-admin/api-types";

type HomeRenderOptions = {
  previewStaticImages?: boolean;
};

function HomeImage({
  src,
  alt,
  width,
  height,
  priority,
  sizes,
  className,
  options,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
  sizes: string;
  className: string;
  options?: HomeRenderOptions;
}) {
  if (options?.previewStaticImages) {
    // The Tauri preview endpoint renders HomeView via renderToStaticMarkup
    // outside Next's app renderer, where next/image cannot be evaluated.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} width={width} height={height} className={className} />;
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      priority={priority}
      sizes={sizes}
      className={className}
    />
  );
}

function sectionClassName(section: SiteAdminHomeSection): string {
  const typeClass =
    section.type === "richText" ? "rich-text" : section.type.toLowerCase();
  return [
    "home-section",
    `home-section--${typeClass}`,
    `home-section--width-${section.width}`,
  ].join(" ");
}

function LinkItems({
  links,
  itemClassName,
}: {
  links: SiteAdminHomeLink[];
  itemClassName: string;
}) {
  return (
    <>
      {links.map((link, index) => (
        <li key={`${link.href}-${link.label}-${index}`} className={itemClassName}>
          {link.href ? (
            <ClassicLink href={link.href}>
              {link.label}
            </ClassicLink>
          ) : (
            <span>{link.label}</span>
          )}
          {link.description && <p>{link.description}</p>}
        </li>
      ))}
    </>
  );
}

async function renderLayoutBlock(
  block: SiteAdminHomeLayoutBlock,
  priority = false,
  options?: HomeRenderOptions,
): Promise<ReactElement | null> {
  if (block.type === "image") {
    if (!block.url) return null;
    return (
      <figure
        key={block.id}
        className={[
          "home-layout__block",
          "home-layout__block--image",
          `home-layout__image--${block.shape}`,
          `home-layout__image--fit-${block.fit}`,
        ].join(" ")}
      >
        <HomeImage
          src={block.url}
          alt={block.alt || ""}
          width={640}
          height={720}
          priority={priority}
          sizes="(max-width: 640px) 100vw, 50vw"
          className="home-layout__img"
          options={options}
        />
        {block.caption && <figcaption>{block.caption}</figcaption>}
      </figure>
    );
  }

  const body = await renderSimpleClassicMarkdown(block.body);
  if (!block.title && !body) return null;
  return (
    <div
      key={block.id}
      className={[
        "home-layout__block",
        "home-layout__block--markdown",
        `home-layout__markdown--${block.tone}`,
        `home-section--align-${block.textAlign}`,
      ].join(" ")}
    >
      {block.title && (
        <h2 className="notion-heading notion-semantic-string">{block.title}</h2>
      )}
      {body && <div className="home-section__body mdx-post__body">{body}</div>}
    </div>
  );
}

async function renderLayoutSection(
  section: SiteAdminHomeLayoutSection,
  options?: HomeRenderOptions,
): Promise<ReactElement | null> {
  const renderedBlocks = await Promise.all(
    section.blocks.map((block, index) =>
      renderLayoutBlock(
        block,
        section.variant === "classicIntro" && index === 0 && block.type === "image",
        options,
      ),
    ),
  );
  const byColumn = Array.from({ length: section.columns }, (_, index) => {
    const column = (index + 1) as 1 | 2 | 3;
    return renderedBlocks.filter((block, blockIndex) => {
      const source = section.blocks[blockIndex];
      return Boolean(block) && source.column === column;
    }) as ReactElement[];
  });
  if (!section.title && byColumn.every((blocks) => blocks.length === 0)) return null;

  return (
    <section
      key={section.id}
      data-home-section-id={section.id}
      className={[
        sectionClassName(section),
        `home-layout--variant-${section.variant}`,
        `home-layout--cols-${section.columns}`,
        `home-layout--gap-${section.gap}`,
        `home-layout--align-${section.verticalAlign}`,
      ].join(" ")}
    >
      {section.title && (
        <h2 className="notion-heading notion-semantic-string home-layout__title">
          {section.title}
        </h2>
      )}
      <div className="home-layout__grid">
        {byColumn.map((blocks, index) => (
          <div className="home-layout__column" key={`column-${index + 1}`}>
            {blocks}
          </div>
        ))}
      </div>
    </section>
  );
}

async function renderHomeSection(
  section: SiteAdminHomeSection,
  options?: HomeRenderOptions,
): Promise<ReactElement | null> {
  if (!section.enabled) return null;

  if (section.type === "hero") {
    const body = await renderSimpleClassicMarkdown(section.body);
    const showImage =
      section.profileImageUrl && section.imagePosition !== "none";
    return (
      <section
        key={section.id}
        data-home-section-id={section.id}
        className={[
          sectionClassName(section),
          "home-hero",
          `home-hero--image-${showImage ? section.imagePosition : "none"}`,
          `home-section--align-${section.textAlign}`,
        ].join(" ")}
      >
        {showImage && (
          <div className="home-hero__image">
            <HomeImage
              src={section.profileImageUrl!}
              alt={section.profileImageAlt || "Profile"}
              width={480}
              height={640}
              priority
              sizes="(max-width: 640px) 100vw, 33vw"
              className="home-hero__img"
              options={options}
            />
          </div>
        )}
        <div className="home-hero__body mdx-post__body">{body}</div>
      </section>
    );
  }

  if (section.type === "richText") {
    const body = await renderSimpleClassicMarkdown(section.body);
    if (!section.title && !body) return null;
    return (
      <section
        key={section.id}
        data-home-section-id={section.id}
        className={[
          sectionClassName(section),
          `home-rich-text--${section.tone}`,
          `home-rich-text--variant-${section.variant}`,
          `home-section--align-${section.textAlign}`,
        ].join(" ")}
      >
        {section.title && (
          <h2 className="notion-heading notion-semantic-string">
            {section.title}
          </h2>
        )}
        {body && <div className="home-section__body mdx-post__body">{body}</div>}
      </section>
    );
  }

  if (section.type === "linkList") {
    const body = await renderSimpleClassicMarkdown(section.body);
    if (!section.title && !body && section.links.length === 0) return null;
    return (
      <section
        key={section.id}
        data-home-section-id={section.id}
        className={[
          sectionClassName(section),
          `home-link-list--${section.layout}`,
        ].join(" ")}
      >
        {section.title && (
          <h2 className="notion-heading notion-semantic-string">
            {section.title}
          </h2>
        )}
        {body && <div className="home-section__body mdx-post__body">{body}</div>}
        {section.links.length > 0 && (
          <ul className="home-link-list__items">
            <LinkItems links={section.links} itemClassName="home-link-list__item" />
          </ul>
        )}
      </section>
    );
  }

  if (section.type === "layout") {
    return renderLayoutSection(section, options);
  }

  const body = await renderSimpleClassicMarkdown(section.body);
  if (!section.title && !body && section.items.length === 0) return null;
  return (
    <section
      key={section.id}
      data-home-section-id={section.id}
      className={[
        sectionClassName(section),
        `home-featured-pages--cols-${section.columns}`,
      ].join(" ")}
    >
      {section.title && (
        <h2 className="notion-heading notion-semantic-string">{section.title}</h2>
      )}
      {body && <div className="home-section__body mdx-post__body">{body}</div>}
      {section.items.length > 0 && (
        <ul className="home-featured-pages__items">
          <LinkItems
            links={section.items}
            itemClassName="home-featured-pages__item"
          />
        </ul>
      )}
    </section>
  );
}

export async function HomeView({
  data,
  previewStaticImages,
}: {
  data: SiteAdminHomeData;
  previewStaticImages?: boolean;
}): Promise<ReactElement> {
  const options: HomeRenderOptions = { previewStaticImages };
  const sections = (
    await Promise.all(data.sections.map((section) => renderHomeSection(section, options)))
  ).filter((section): section is ReactElement => Boolean(section));

  return (
    <ClassicPageShell
      title={data.title}
      className="super-content page__index parent-page__index"
    >
      {sections}
    </ClassicPageShell>
  );
}
