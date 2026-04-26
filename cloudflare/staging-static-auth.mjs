const SESSION_COOKIE_NAMES = [
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
];

function textEncoder() {
  return new TextEncoder();
}

function base64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToString(bytes) {
  return new TextDecoder().decode(bytes);
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function normalizeGithubLogin(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

export function parseAllowedGithubUsers(raw) {
  const out = new Set();
  for (const part of String(raw || "").split(/[,\n]/)) {
    const login = normalizeGithubLogin(part);
    if (login) out.add(login);
  }
  return out;
}

export function parseCookieHeader(header) {
  const cookies = new Map();
  for (const part of String(header || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const rawValue = part.slice(idx + 1).trim();
    if (!name) continue;
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      // Cookie values are commonly already plain base64url strings.
    }
    cookies.set(name, value);
  }
  return cookies;
}

export function readSessionCookie(cookieHeader) {
  const cookies = parseCookieHeader(cookieHeader);
  for (const baseName of SESSION_COOKIE_NAMES) {
    if (cookies.has(baseName)) return cookies.get(baseName) || "";
    const chunks = [...cookies.entries()]
      .filter(([name]) => name.startsWith(`${baseName}.`))
      .sort(([a], [b]) => {
        const ai = Number.parseInt(a.split(".").pop() || "0", 10);
        const bi = Number.parseInt(b.split(".").pop() || "0", 10);
        return ai - bi;
      })
      .map(([, value]) => value);
    if (chunks.length) return chunks.join("");
  }
  return "";
}

async function deriveNextAuthAesKey(secret) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto is unavailable");
  const encoder = textEncoder();
  const keyMaterial = await subtle.importKey(
    "raw",
    encoder.encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(),
      info: encoder.encode("NextAuth.js Generated Encryption Key"),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

export async function decryptNextAuthPayload(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 5) return null;

  const [protectedHeader, encryptedKey, ivPart, ciphertextPart, tagPart] = parts;
  if (encryptedKey) return null;

  let header;
  try {
    header = JSON.parse(bytesToString(base64UrlToBytes(protectedHeader)));
  } catch {
    return null;
  }
  if (header?.alg !== "dir" || header?.enc !== "A256GCM") return null;

  try {
    const key = await deriveNextAuthAesKey(secret);
    const encoder = textEncoder();
    const plaintext = await globalThis.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(ivPart),
        additionalData: encoder.encode(protectedHeader),
        tagLength: 128,
      },
      key,
      concatBytes(base64UrlToBytes(ciphertextPart), base64UrlToBytes(tagPart)),
    );
    const payload = JSON.parse(bytesToString(new Uint8Array(plaintext)));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload?.exp === "number" && payload.exp + 15 < now) return null;
    if (typeof payload?.nbf === "number" && payload.nbf - 15 > now) return null;
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

export async function isStagingStaticShellAuthorized(request, env) {
  const secret = String(env?.NEXTAUTH_SECRET || env?.AUTH_SECRET || "").trim();
  if (!secret) return false;

  const allowed = parseAllowedGithubUsers(env?.SITE_ADMIN_GITHUB_USERS || "");
  if (!allowed.size) return false;

  const token = readSessionCookie(request.headers.get("cookie") || "");
  if (!token) return false;

  const payload = await decryptNextAuthPayload(token, secret);
  const login = normalizeGithubLogin(payload?.login || "");
  return Boolean(login && allowed.has(login));
}
