import dns from "node:dns/promises";
import net from "node:net";

// SSRF host classification for outbound fetches (currently the admin
// bookmark/OG endpoint). Extracted into its own module so the IP-range logic
// is unit-testable without pulling in the Next route.
//
// Design notes:
//   - WHATWG `new URL()` canonicalizes IPv4 alternate encodings
//     (decimal / hex / octal / mixed) to dotted-quad and IPv4-mapped IPv6 to
//     its *hex* form (e.g. `::ffff:127.0.0.1` -> `::ffff:7f00:1`) BEFORE we ever
//     inspect `hostname`. Classification therefore works on the canonical form,
//     and IPv6 is decoded to its 16 bytes rather than matched as a string —
//     string matching missed the hex IPv4-mapped form entirely.
//   - On runtimes without functional DNS (e.g. Cloudflare workerd), the literal
//     checks still apply; the DNS resolution check is best-effort (see
//     `assertPublicUrl`).

export function isBlockedIpv4(ip: string): boolean {
  const parts = String(ip).split(".");
  if (parts.length !== 4) return true;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

/** Decode an IPv6 literal to its 16 bytes, or null if unparseable. */
export function ipv6ToBytes(input: string): Uint8Array | null {
  let s = String(input || "").trim().toLowerCase();
  if (!s) return null;
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone); // drop scope id

  // A trailing dotted-IPv4 group (e.g. ::ffff:1.2.3.4) — defensive; the URL
  // parser normally hands us the hex form, but redirect Locations / callers may
  // not have gone through it.
  const lastColon = s.lastIndexOf(":");
  if (lastColon >= 0 && s.slice(lastColon + 1).includes(".")) {
    const tail = s.slice(lastColon + 1);
    const octs = tail.split(".").map((o) => Number(o));
    if (octs.length !== 4 || octs.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return null;
    }
    const hi = ((octs[0] << 8) | octs[1]).toString(16);
    const lo = ((octs[2] << 8) | octs[3]).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tailParts = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;

  let groups: string[];
  if (tailParts === null) {
    groups = head;
    if (groups.length !== 8) return null;
  } else {
    const missing = 8 - (head.length + tailParts.length);
    if (missing < 1) return null; // "::" must stand in for >=1 group
    groups = [...head, ...Array(missing).fill("0"), ...tailParts];
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const g = groups[i];
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const val = Number.parseInt(g, 16);
    bytes[i * 2] = (val >> 8) & 0xff;
    bytes[i * 2 + 1] = val & 0xff;
  }
  return bytes;
}

export function isBlockedIpv6(ip: string): boolean {
  const b = ipv6ToBytes(ip);
  if (!b) return true; // fail closed on anything we cannot decode

  const zeros = (n: number) => {
    for (let i = 0; i < n; i += 1) if (b[i] !== 0) return false;
    return true;
  };
  const embeddedV4 = (start: number) =>
    isBlockedIpv4(`${b[start]}.${b[start + 1]}.${b[start + 2]}.${b[start + 3]}`);

  if (zeros(16)) return true; // :: unspecified
  if (zeros(15) && b[15] === 1) return true; // ::1 loopback

  // IPv4-mapped ::ffff:0:0/96  and IPv4-compatible ::/96 (deprecated): the
  // address is really an IPv4 target — classify by the embedded IPv4.
  if (zeros(10) && b[10] === 0xff && b[11] === 0xff) return embeddedV4(12);
  if (zeros(12)) return embeddedV4(12);
  // 6to4 2002::/16 wraps an IPv4 address in bytes 2..5.
  if (b[0] === 0x20 && b[1] === 0x02) return embeddedV4(2);
  // NAT64 well-known prefix 64:ff9b::/96 wraps an IPv4 address in bytes 12..15.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return embeddedV4(12);

  if (b[0] === 0xff) return true; // ff00::/8 multicast
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true; // fec0::/10 site-local (deprecated)
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local (ULA)
  return false;
}

export function isBlockedHost(hostname: string): boolean {
  let h = String(hostname || "").trim().toLowerCase();
  if (!h) return true;
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true;
  }
  const kind = net.isIP(h);
  if (kind === 4) return isBlockedIpv4(h);
  if (kind === 6) return isBlockedIpv6(h);
  return false; // a real hostname — resolved + re-checked in assertPublicUrl
}

export type AssertUrlResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Validate a single URL (the initial request and every redirect hop).
 *
 * Beyond the literal-host checks it resolves the hostname and rejects when any
 * A/AAAA record points at an internal address. This is BEST-EFFORT: on runtimes
 * without functional `node:dns` (e.g. Cloudflare workerd) the lookup throws and
 * we fall back to the literal checks rather than hard-failing every hostname.
 *
 * Known residual: resolution is not pinned, so a rebinding host that answers
 * with a public address here and a private one at fetch time can still slip
 * through. Acceptable for this admin-only endpoint; closing it fully needs an
 * IP-pinned connector that is not portable to workerd.
 */
export async function assertPublicUrl(rawUrl: string): Promise<AssertUrlResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: "invalid url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "only http(s) urls are supported" };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, error: "refusing to fetch internal address" };
  }
  const bare = parsed.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bare) === 0) {
    let records: { address: string }[] | null = null;
    try {
      records = await dns.lookup(bare, { all: true });
    } catch {
      records = null; // DNS unavailable/transient — rely on literal checks
    }
    if (records && records.length > 0 && records.some((r) => isBlockedHost(r.address))) {
      return { ok: false, error: "host resolves to an internal address" };
    }
  }
  return { ok: true, url: parsed.toString() };
}
