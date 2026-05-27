import NextAuth from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import type { NextAuthOptions } from "next-auth";
import type { OAuthConfig } from "next-auth/providers/oauth";

import {
  isAllowedAdminSessionIdentity,
  normalizeAdminEmail,
  type SiteAdminSessionIdentity,
} from "@/lib/site-admin-auth";
import { normalizeGithubUser } from "@/lib/shared/github-users";

type JinnkunnAuthProfile = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
};

function normalizedIssuer(): string {
  return String(process.env.JINNKUNN_AUTH_ISSUER || "https://auth.jinnkunn.com").replace(
    /\/+$/,
    "",
  );
}

function buildJinnkunnAuthProvider(): OAuthConfig<JinnkunnAuthProfile> | null {
  if (String(process.env.JINNKUNN_AUTH_ENABLED || "1").trim() === "0") return null;

  const issuer = normalizedIssuer();
  const clientId = String(process.env.JINNKUNN_AUTH_CLIENT_ID || "jinkunchen-site-admin").trim();
  if (!issuer || !clientId) return null;

  const clientSecret = String(process.env.JINNKUNN_AUTH_CLIENT_SECRET || "").trim();
  const tokenEndpointAuthMethod = clientSecret ? "client_secret_post" : "none";
  return {
    id: "jinnkunn-auth",
    name: "Jinnkunn Auth",
    type: "oauth",
    issuer,
    wellKnown: `${issuer}/.well-known/openid-configuration`,
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    checks: ["pkce", "state"],
    idToken: true,
    authorization: {
      params: {
        scope: "openid email profile",
      },
    },
    client: {
      token_endpoint_auth_method: tokenEndpointAuthMethod,
    },
    profile(profile: JinnkunnAuthProfile) {
      const email = normalizeAdminEmail(profile.email);
      const name = String(profile.name || profile.preferred_username || email || "").trim();
      return {
        id: String(profile.sub || email || "").trim(),
        name: name || null,
        email: email || null,
        image: null,
      };
    },
  };
}

function buildGithubProvider() {
  const clientId = String(process.env.GITHUB_ID || "").trim();
  const clientSecret = String(process.env.GITHUB_SECRET || "").trim();
  if (!clientId || !clientSecret) return null;
  return GitHubProvider({ clientId, clientSecret });
}

function profileRecord(profile: unknown): Record<string, unknown> {
  return profile && typeof profile === "object" && !Array.isArray(profile)
    ? (profile as Record<string, unknown>)
    : {};
}

function identityFromAuthCallback(args: {
  provider?: string;
  profile?: unknown;
  user?: unknown;
  token?: Record<string, unknown>;
}): SiteAdminSessionIdentity | null {
  const profile = profileRecord(args.profile);
  const user = profileRecord(args.user);
  const token = args.token || {};
  const provider = String(args.provider || token.provider || "").trim();
  const login =
    provider === "github"
      ? normalizeGithubUser(profile.login || token.login)
      : normalizeGithubUser(token.login);
  const email = normalizeAdminEmail(profile.email || user.email || token.email);
  const subject = String(profile.sub || user.id || token.authSubject || token.sub || "")
    .trim()
    .toLowerCase();
  const actor = email || login || subject;
  return actor ? { actor, login, email, subject } : null;
}

const providers = [buildJinnkunnAuthProvider(), buildGithubProvider()].filter(
  (provider): provider is NonNullable<typeof provider> => Boolean(provider),
);

const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  providers,
  callbacks: {
    async signIn({ account, profile, user }) {
      const identity = identityFromAuthCallback({
        provider: account?.provider,
        profile,
        user,
      });
      return isAllowedAdminSessionIdentity(identity);
    },
    async jwt({ token, account, profile, user }) {
      const identity = identityFromAuthCallback({
        provider: account?.provider,
        profile,
        user,
        token: token as Record<string, unknown>,
      });
      const login = identity?.login || "";
      const email = identity?.email || normalizeAdminEmail((token as Record<string, unknown>).email);
      const subject = identity?.subject || String(token.sub || "").trim().toLowerCase();
      if (account?.provider) (token as Record<string, unknown>).provider = account.provider;
      if (login) (token as Record<string, unknown>).login = login;
      if (email) (token as Record<string, unknown>).email = email;
      if (subject) (token as Record<string, unknown>).authSubject = subject;
      return token;
    },
    async session({ session, token }) {
      const login = String((token as Record<string, unknown>)?.login ?? "").trim();
      const email = normalizeAdminEmail((token as Record<string, unknown>)?.email);
      const subject = String((token as Record<string, unknown>)?.authSubject ?? "").trim();
      if (session.user && login) {
        (session.user as Record<string, unknown>).login = login;
      }
      if (session.user && email) {
        session.user.email = email;
      }
      if (session.user && subject) {
        (session.user as Record<string, unknown>).authSubject = subject;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
