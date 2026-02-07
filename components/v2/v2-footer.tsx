import styles from "./v2-footer.module.css";

export default function V2Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.left}>
          <div className={styles.brand}>Jinkun Chen</div>
          <div className={styles.note}>
            Editorial v2 prototype. Classic version remains at <a href="/">/</a>.
          </div>
        </div>
        <div className={styles.right}>
          <a href="/v2">Home</a>
          <a href="/v2/publications">Publications</a>
          <a href="/v2/works">Works</a>
          <a href="/v2/news">News</a>
        </div>
      </div>
    </footer>
  );
}

