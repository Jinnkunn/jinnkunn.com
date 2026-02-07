import styles from "./page.module.css";

export default function V2Bio() {
  return (
    <div className={styles.wrap}>
      <div className={styles.kicker}>V2</div>
      <h1 className={styles.title}>Bio</h1>
      <p className={styles.p}>
        Placeholder for the Editorial v2 bio page. The classic bio page is at{" "}
        <a href="/bio">/bio</a>.
      </p>
    </div>
  );
}

