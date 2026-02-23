const FESTIVAL_LANTERN_SRC =
  "https://cdn.jinkunchen.com/web_image/year_of_horse/lantern.png";
const FESTIVAL_POETRY_SRC =
  "https://cdn.jinkunchen.com/web_image/year_of_horse/poetry.png";
const FESTIVAL_KOI_SRC =
  "https://cdn.jinkunchen.com/web_image/year_of_horse/koi2_golden.png";

export default function FestivalOverlay() {
  return (
    <aside className="festival-overlay" aria-hidden="true">
      <section className="festival-overlay__left">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="festival-overlay__lantern"
          src={FESTIVAL_LANTERN_SRC}
          alt=""
          loading="eager"
          decoding="async"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="festival-overlay__poetry"
          src={FESTIVAL_POETRY_SRC}
          alt=""
          loading="eager"
          decoding="async"
        />
      </section>

      <section className="festival-overlay__right">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="festival-overlay__koi"
          src={FESTIVAL_KOI_SRC}
          alt=""
          loading="lazy"
          decoding="async"
        />
      </section>
    </aside>
  );
}
