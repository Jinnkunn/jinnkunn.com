import styles from "./v2-shell.module.css";
import V2Nav from "@/components/v2/v2-nav";
import V2Footer from "@/components/v2/v2-footer";
import { v2Sans, v2Serif } from "./fonts";

export default function V2Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className={`${styles.shell} ${v2Sans.variable} ${v2Serif.variable}`}>
      <div className={styles.paper} aria-hidden />
      <div className={styles.frame}>
        <V2Nav />
        <main className={styles.main}>{children}</main>
        <V2Footer />
      </div>
    </div>
  );
}
