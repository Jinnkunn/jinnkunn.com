import styles from "./page.module.css";

export default function V2Blog() {
  return (
    <div className={styles.wrap}>
      <div className={styles.kicker}>V2</div>
      <h1 className={styles.title}>Blog</h1>
      <p className={styles.p}>
        Placeholder for the Editorial v2 blog index. For now, the classic blog
        remains available at <a href="/blog">/blog</a>.
      </p>
    </div>
  );
}

