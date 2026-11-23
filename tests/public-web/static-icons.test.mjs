import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { webManifestResponse } from "../../lib/seo/web-manifest.ts";

const root = process.cwd();

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.name === "route.ts" || entry.name === "route.tsx") out.push(abs);
  }
  return out;
}

function pngSize(buffer) {
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG", "expected PNG signature");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("force-static route handlers never derive URLs from the request", () => {
  // `force-static` handlers are prerendered at build time, where `req.url` is
  // `http://localhost:3000/...`. `/favicon.ico`, `/apple-touch-icon*.png` and
  // `/manifest.json` shipped 307s to localhost that way.
  const offenders = walk(path.join(root, "app")).filter((file) => {
    const source = fs.readFileSync(file, "utf8");
    return /export const dynamic = "force-static"/.test(source) && /\b(req|request)\.url\b/.test(source);
  });
  assert.deepEqual(offenders.map((file) => path.relative(root, file)), []);
});

test("root icon probes are real static files, not redirects", () => {
  for (const route of ["favicon.ico", "apple-touch-icon.png", "apple-touch-icon-precomposed.png"]) {
    assert.equal(fs.existsSync(path.join(root, "app", route)), false, `app/${route} would shadow public/${route}`);
  }

  const ico = fs.readFileSync(path.join(root, "public", "favicon.ico"));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1, "ICO type");
  const count = ico.readUInt16LE(4);
  const sizes = [];
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    const image = pngSize(ico.subarray(offset, offset + length));
    assert.equal(image.width, ico.readUInt8(entry) || 256);
    sizes.push(image.width);
  }
  assert.deepEqual(sizes, [16, 32, 48]);

  for (const name of ["apple-touch-icon.png", "apple-touch-icon-precomposed.png"]) {
    assert.deepEqual(pngSize(fs.readFileSync(path.join(root, "public", name))), { width: 180, height: 180 });
  }
});

test("/manifest.json and /site.webmanifest serve the same manifest without a redirect", async () => {
  const response = webManifestResponse();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.match(response.headers.get("content-type") || "", /application\/manifest\+json/);
  const manifest = await response.json();
  assert.deepEqual(
    manifest.icons.map((icon) => icon.sizes),
    ["512x512", "180x180"],
  );

  for (const route of ["manifest.json", "site.webmanifest"]) {
    const source = fs.readFileSync(path.join(root, "app", route, "route.ts"), "utf8");
    assert.match(source, /webManifestResponse\(\)/, route);
    assert.doesNotMatch(source, /\.redirect\(|["']location["']/i, route);
  }
});
