import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ padding: "40px 20px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>404</h1>
      <p style={{ marginBottom: 16 }}>This page could not be found.</p>
      <Link href="/" className="notion-link link">
        Go home
      </Link>
    </main>
  );
}

