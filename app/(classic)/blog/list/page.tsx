import Link from "next/link";
import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Blog List",
  description: "Jinkun's Blog",
};

export default async function BlogListPage() {
  // This route is kept for backward compatibility; canonical blog list is `/blog`.
  // Use a redirect rather than duplicating the UI.
  return (
    <main style={{ padding: "40px 20px" }}>
      <p>
        This page has moved to{" "}
        <Link href="/blog" className="notion-link link">
          /blog
        </Link>
        .
      </p>
    </main>
  );
}
