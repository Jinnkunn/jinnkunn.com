import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPublicUrl,
  isBlockedHost,
  isBlockedIpv4,
  isBlockedIpv6,
} from "../../lib/server/ssrf-guard.ts";

test("blocks internal IPv4 ranges, allows public", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "0.0.0.0",
    "100.64.0.1", // CGNAT
    "224.0.0.1", // multicast
  ]) {
    assert.equal(isBlockedIpv4(ip), true, `${ip} should be blocked`);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "172.15.0.1"]) {
    assert.equal(isBlockedIpv4(ip), false, `${ip} should be allowed`);
  }
});

test("blocks IPv4-mapped IPv6 in BOTH dotted and canonical hex forms (the reported bypass)", () => {
  // Dotted (defensive) and the hex form WHATWG URL actually produces.
  for (const ip of [
    "::ffff:127.0.0.1",
    "::ffff:7f00:1", // == 127.0.0.1, the verified bypass vector
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe", // == 169.254.169.254 metadata
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    "::ffff:192.168.1.1",
    "::ffff:c0a8:101",
  ]) {
    assert.equal(isBlockedIpv6(ip), true, `${ip} should be blocked`);
    assert.equal(isBlockedHost(`[${ip}]`), true, `[${ip}] host should be blocked`);
  }
  // Public IPv4-mapped must stay allowed.
  assert.equal(isBlockedIpv6("::ffff:8.8.8.8"), false);
  assert.equal(isBlockedIpv6("::ffff:808:808"), false); // == 8.8.8.8
});

test("blocks loopback, unspecified, ULA, link-local, site-local, multicast", () => {
  for (const ip of [
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fec0::1", // deprecated site-local
    "ff02::1", // multicast all-nodes
    "ff00::",
  ]) {
    assert.equal(isBlockedIpv6(ip), true, `${ip} should be blocked`);
  }
});

test("blocks 6to4 and NAT64 wrappers of internal IPv4", () => {
  assert.equal(isBlockedIpv6("2002:7f00:1::1"), true); // 6to4 of 127.0.0.1
  assert.equal(isBlockedIpv6("2002:a9fe:a9fe::1"), true); // 6to4 of 169.254.169.254
  assert.equal(isBlockedIpv6("64:ff9b::7f00:1"), true); // NAT64 of 127.0.0.1
  assert.equal(isBlockedIpv6("64:ff9b::a9fe:a9fe"), true); // NAT64 of metadata
  // 6to4 of a public IPv4 stays allowed.
  assert.equal(isBlockedIpv6("2002:0808:0808::1"), false); // 6to4 of 8.8.8.8
});

test("allows real public IPv6", () => {
  assert.equal(isBlockedIpv6("2001:4860:4860::8888"), false); // Google DNS
  assert.equal(isBlockedIpv6("2606:4700:4700::1111"), false); // Cloudflare DNS
});

test("fails closed on undecodable IPv6", () => {
  assert.equal(isBlockedIpv6("not-an-ip"), true);
  assert.equal(isBlockedIpv6(":::::"), true);
});

test("isBlockedHost handles hostnames and IPv4 alt-encodings via URL canonicalization", () => {
  assert.equal(isBlockedHost("localhost"), true);
  assert.equal(isBlockedHost("foo.localhost"), true);
  assert.equal(isBlockedHost("svc.internal"), true);
  assert.equal(isBlockedHost("printer.local"), true);
  assert.equal(isBlockedHost("example.com"), false);
  // WHATWG URL normalizes these to 127.0.0.1 before isBlockedHost sees them.
  assert.equal(isBlockedHost(new URL("http://0x7f000001/").hostname), true);
  assert.equal(isBlockedHost(new URL("http://2130706433/").hostname), true);
  assert.equal(isBlockedHost(new URL("http://[::ffff:127.0.0.1]/").hostname), true);
});

test("assertPublicUrl rejects bad schemes and internal literals without needing DNS", async () => {
  assert.equal((await assertPublicUrl("file:///etc/passwd")).ok, false);
  assert.equal((await assertPublicUrl("gopher://127.0.0.1/")).ok, false);
  assert.equal((await assertPublicUrl("http://[::ffff:7f00:1]/")).ok, false);
  assert.equal((await assertPublicUrl("http://169.254.169.254/latest/meta-data/")).ok, false);
  assert.equal((await assertPublicUrl("not a url")).ok, false);
  // A public IPv4 literal needs no DNS and is allowed.
  assert.equal((await assertPublicUrl("http://93.184.216.34/")).ok, true);
});
