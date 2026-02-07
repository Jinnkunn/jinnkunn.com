import styles from "./page.module.css";

export default function V2Works() {
  return (
    <div className={styles.page}>
      <div className={styles.kicker}>v2</div>
      <h1 className={styles.title}>Works</h1>
      <p className={styles.lede}>
        Placeholder. Next step: a gallery-like list of projects with a one-line
        thesis each, kept editorial and restrained.
      </p>
    </div>
  );
}

