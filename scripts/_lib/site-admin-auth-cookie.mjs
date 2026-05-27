import { encode } from "next-auth/jwt";

function normalizeGithubLogin(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function normalizeAdminEmail(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw && raw.includes("@") ? raw : "";
}

export function firstAllowedSiteAdminIdentity(env = process.env) {
  for (const part of String(env.SITE_ADMIN_EMAILS || "").split(/[,\n]/)) {
    const email = normalizeAdminEmail(part);
    if (email) {
      return {
        kind: "email",
        value: email,
        token: {
          sub: `synthetic-${email}`,
          email,
          name: email.split("@")[0] || email,
        },
      };
    }
  }

  for (const part of String(env.SITE_ADMIN_GITHUB_USERS || "").split(/[,\n]/)) {
    const login = normalizeGithubLogin(part);
    if (login) {
      return {
        kind: "github",
        value: login,
        token: {
          sub: `synthetic-${login}`,
          login,
          name: login,
        },
      };
    }
  }

  return null;
}

export async function createNextAuthSessionCookie({
  secret,
  env = process.env,
  maxAge = 5 * 60,
  subjectPrefix = "site-admin",
} = {}) {
  const resolvedSecret = String(secret || env.NEXTAUTH_SECRET || env.AUTH_SECRET || "").trim();
  if (!resolvedSecret) {
    return {
      ok: false,
      cookie: "",
      identity: null,
      reason: "NEXTAUTH_SECRET/AUTH_SECRET is missing.",
    };
  }

  const identity = firstAllowedSiteAdminIdentity(env);
  if (!identity) {
    return {
      ok: false,
      cookie: "",
      identity: null,
      reason: "SITE_ADMIN_EMAILS or SITE_ADMIN_GITHUB_USERS has no allowed identity.",
    };
  }

  const token = await encode({
    secret: resolvedSecret,
    token: {
      ...identity.token,
      sub: `${subjectPrefix}-${identity.value}`,
    },
    maxAge,
  });
  return {
    ok: true,
    cookie: `__Secure-next-auth.session-token=${token}; next-auth.session-token=${token}`,
    identity,
    reason: "",
  };
}
