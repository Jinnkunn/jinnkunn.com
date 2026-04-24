import "server-only";

import Image from "next/image";
import type { ReactElement } from "react";

import { compilePostMdx } from "@/lib/posts/compile";
import { postMdxComponents } from "@/components/posts-mdx/components";
import type { SiteAdminHomeData } from "@/lib/site-admin/api-types";

export async function HomeView({
  data,
}: {
  data: SiteAdminHomeData;
}): Promise<ReactElement> {
  const { Content } = data.body.trim()
    ? await compilePostMdx(data.body)
    : { Content: null };

  return (
    <main
      id="main-content"
      className="super-content page__index parent-page__index"
    >
      <div className="notion-header page">
        <div className="notion-header__cover no-cover no-icon" />
        <div className="notion-header__content max-width no-cover no-icon">
          <div className="notion-header__title-wrapper">
            <h1 className="notion-header__title">{data.title}</h1>
          </div>
        </div>
      </div>
      <article className="notion-root max-width has-footer">
        <div className="home-hero">
          {data.profileImageUrl && (
            <div className="home-hero__image">
              <Image
                src={data.profileImageUrl}
                alt={data.profileImageAlt || "Profile"}
                width={480}
                height={640}
                priority
                sizes="(max-width: 640px) 100vw, 33vw"
                className="home-hero__img"
              />
            </div>
          )}
          <div className="home-hero__body mdx-post__body">
            {Content && <Content components={postMdxComponents} />}
          </div>
        </div>
      </article>
    </main>
  );
}
