import Image from "next/image";
import Link from "next/link";
import styles from "./v2.module.css";
import { v2Site } from "@/content/v2/site";

export default function V2Home() {
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.portraitCol}>
          <div className={styles.portraitFrame}>
            <div className={styles.portraitHalo} aria-hidden />
            <Image
              src="/assets/profile.png"
              alt="Portrait of Jinkun Chen"
              width={900}
              height={1200}
              priority
              className={styles.portrait}
            />
          </div>
          <div className={styles.sideNote}>
            <div className={styles.sideKicker}>Index</div>
            <ol className={styles.sideList}>
              <li>
                <a href="#research">Research focus</a>
              </li>
              <li>
                <a href="#selected">Selected work</a>
              </li>
              <li>
                <a href="#contact">Contact</a>
              </li>
            </ol>
          </div>
        </div>

        <div className={styles.copyCol}>
          <div className={styles.kicker}>
            {v2Site.role} · {v2Site.affiliation}
          </div>
          <h1 className={styles.title}>
            {v2Site.name}
            <span className={styles.pronouns}>({v2Site.pronouns})</span>
          </h1>
          <p className={styles.lede}>{v2Site.intro}</p>

          <div className={styles.metaRow}>
            <div className={styles.metaItem}>
              <div className={styles.metaLabel}>Now</div>
              <div className={styles.metaValue}>{v2Site.locationLine}</div>
            </div>
            <div className={styles.metaItem}>
              <div className={styles.metaLabel}>Focus</div>
              <div className={styles.metaValue}>
                Agents, memory, interpretability
              </div>
            </div>
          </div>

          <div className={styles.ctaRow}>
            <Link className={styles.ctaPrimary} href="/v2/publications">
              Read Publications
            </Link>
            <a className={styles.ctaSecondary} href={v2Site.links[0].href}>
              Email
            </a>
            <Link className={styles.ctaSecondary} href="/v2/works">
              Works
            </Link>
          </div>
        </div>
      </header>

      <section id="research" className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionNo}>01</div>
          <h2 className={styles.sectionTitle}>Research Focus</h2>
        </div>

        <div className={styles.tagGrid}>
          {v2Site.tags.map((t) => (
            <div key={t.label} className={styles.tagCard}>
              <div className={styles.tagLabel}>{t.label}</div>
              <div className={styles.tagDetail}>{t.detail}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="selected" className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionNo}>02</div>
          <h2 className={styles.sectionTitle}>Selected</h2>
        </div>

        <div className={styles.split}>
          <div className={styles.card}>
            <div className={styles.cardKicker}>Publications</div>
            <ul className={styles.list}>
              {v2Site.selected.publications.map((p) => (
                <li key={`${p.year}-${p.title}`} className={styles.listItem}>
                  <Link href={p.href} className={styles.listLink}>
                    <span className={styles.listYear}>{p.year}</span>
                    <span className={styles.listTitle}>{p.title}</span>
                    <span className={styles.listVenue}>{p.venue}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className={styles.card}>
            <div className={styles.cardKicker}>Works</div>
            <ul className={styles.list}>
              {v2Site.selected.works.map((w) => (
                <li key={w.title} className={styles.listItem}>
                  <Link href={w.href} className={styles.workLink}>
                    <span className={styles.workTitle}>{w.title}</span>
                    <span className={styles.workDesc}>{w.desc}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="contact" className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionNo}>03</div>
          <h2 className={styles.sectionTitle}>Contact</h2>
        </div>

        <div className={styles.contactBox}>
          <div className={styles.contactLine}>
            <span className={styles.contactLabel}>Email</span>
            <a href={v2Site.links[0].href} className={styles.contactValue}>
              {v2Site.links[0].hint}
            </a>
          </div>
          <div className={styles.contactLinks}>
            {v2Site.links.slice(1).map((l) => (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className={styles.pill}
              >
                {l.label}
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

