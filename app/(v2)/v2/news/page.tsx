import styles from "./page.module.css";

export default function V2News() {
  return (
    <div className={styles.page}>
      <div className={styles.kicker}>v2</div>
      <h1 className={styles.title}>News</h1>
      <p className={styles.lede}>
        Placeholder. Next step: a clean timeline with dates in the margin and
        short entries, optimized for scanning.
      </p>
    </div>
  );
}

