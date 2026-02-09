import NextAuth from "next-auth";
import GitHubProvider from "next-auth/providers/github";

// NextAuth v4 is strict about server configuration in production.
// On Vercel, `NEXTAUTH_URL` is often not set explicitly; fall back to `VERCEL_URL`.
if (!process.env.NEXTAUTH_URL?.trim() && process.env.VERCEL_URL?.trim()) {
  process.env.NEXTAUTH_URL = `https://${process.env.VERCEL_URL.trim()}`;
}

function parseAllowedUsers(): Set<string> {
  const raw = (process.env.SITE_ADMIN_GITHUB_USERS || "").trim();
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^@/, "").toLowerCase());
  return new Set(items);
}

const allowed = parseAllowedUsers();

const handler = NextAuth({
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID || "",
      clientSecret: process.env.GITHUB_SECRET || "",
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      // Safety default: if allowlist is empty, deny sign-in to /site-admin.
      if (!allowed.size) return false;
      const login = String((profile as { login?: unknown } | undefined)?.login ?? "")
        .trim()
        .replace(/^@/, "")
        .toLowerCase();
      return Boolean(login) && allowed.has(login);
    },
    async jwt({ token, profile }) {
      const login = String((profile as { login?: unknown } | undefined)?.login ?? "")
        .trim()
        .replace(/^@/, "")
        .toLowerCase();
      if (login) (token as Record<string, unknown>).login = login;
      return token;
    },
    async session({ session, token }) {
      const login = String((token as Record<string, unknown>)?.login ?? "").trim();
      if (session.user && login) {
        (session.user as Record<string, unknown>).login = login;
      }
      return session;
    },
  },
});

export { handler as GET, handler as POST };
