import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactBucketName,
  artifactObjectKey,
} from "../../scripts/_lib/release-artifact-store.mjs";

test("artifact store: object key is code+content addressed", () => {
  const key = artifactObjectKey({
    codeSha: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    contentSha: "cccccccccccccccccccccccccccccccccccccccc",
  });
  assert.equal(
    key,
    "release-artifacts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-cccccccccccccccccccccccccccccccccccccccc.tar.gz",
  );
});

test("artifact store: refuses to build keys from junk SHAs", () => {
  assert.equal(artifactObjectKey({ codeSha: "", contentSha: "c".repeat(40) }), "");
  assert.equal(artifactObjectKey({ codeSha: "a".repeat(40), contentSha: "not a sha" }), "");
  assert.equal(
    artifactObjectKey({ codeSha: "../escape", contentSha: "c".repeat(40) }),
    "",
  );
});

test("artifact store: bucket name comes from wrangler.toml r2 block", () => {
  const toml = `
[[r2_buckets]]
binding = "SITE_ASSETS"
bucket_name = "my-bucket"
preview_bucket_name = "my-bucket"

[vars]
X = "1"
`;
  assert.equal(artifactBucketName({ wranglerToml: toml }), "my-bucket");
});

test("artifact store: falls back to the canonical bucket when unparseable", () => {
  assert.equal(artifactBucketName({ wranglerToml: "[vars]\nX = \"1\"\n" }), "jinnkunn");
});
