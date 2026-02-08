import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ padding: "40px 20px", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, marginBottom: 10, letterSpacing: -0.2 }}>
        404
      </h1>
      <p style={{ marginBottom: 18 }}>
        This page could not be found. Try going back to the homepage.
      </p>
      <Link href="/" className="notion-link link">
        Home
      </Link>
    </main>
  );
}
