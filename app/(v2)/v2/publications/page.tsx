import styles from "./page.module.css";

export default function V2Publications() {
  return (
    <div className={styles.page}>
      <div className={styles.kicker}>v2</div>
      <h1 className={styles.title}>Publications</h1>
      <p className={styles.lede}>
        This page is a placeholder for the Editorial Research Dossier layout. Next
        step: render a scannable list (year grouping, tags, PDF/code links).
      </p>
    </div>
  );
}

