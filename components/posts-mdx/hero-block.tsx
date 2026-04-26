import "server-only";

import Image from "next/image";
import type { ReactElement } from "react";

interface HeroBlockProps {
  title?: string;
  subtitle?: string;
  imageUrl?: string;
  imageAlt?: string;
  /** Default "right". `none` hides the image entirely. */
  imagePosition?: "left" | "right" | "top" | "none";
  /** Default "left". */
  textAlign?: "left" | "center" | "right";
}

function isCdnMediaSrc(src: string): boolean {
  return src.startsWith("https://cdn.jinkunchen.com/");
}

/** Insertable hero section. Originally lifted from the Home builder so
 * any page can drop in a profile-image + headline block without going
 * through HomePanel's section ceremony. Renders into the same
 * `home-hero` markup as the Home page so existing CSS applies. */
export function HeroBlock({
  title,
  subtitle,
  imageUrl,
  imageAlt = "Profile",
  imagePosition = "right",
  textAlign = "left",
}: HeroBlockProps): ReactElement {
  const showImage = Boolean(imageUrl) && imagePosition !== "none";
  return (
    <section
      className={[
        "home-section",
        "home-section--hero",
        "home-hero",
        `home-hero--image-${showImage ? imagePosition : "none"}`,
        `home-section--align-${textAlign}`,
      ].join(" ")}
    >
      {showImage && imageUrl ? (
        <div className="home-hero__image">
          <Image
            src={imageUrl}
            alt={imageAlt}
            width={480}
            height={640}
            priority
            sizes="(max-width: 640px) 100vw, 33vw"
            className="home-hero__img"
            unoptimized={isCdnMediaSrc(imageUrl)}
          />
        </div>
      ) : null}
      <div className="home-hero__body mdx-post__body">
        {title ? <h1>{title}</h1> : null}
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
    </section>
  );
}
