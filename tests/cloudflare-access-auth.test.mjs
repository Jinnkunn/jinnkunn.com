import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  CloudflareAccessVerifyError,
  readCloudflareAccessConfigFromEnv,
  verifyCloudflareAccessFromHeaders,
  verifyCloudflareAccessJwt,
} from "../lib/server/cloudflare-access-auth.ts";

const TEAM_DOMAIN = "example-team.cloudflareaccess.com";
const AUD = "test-aud-123";

function base64Url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwt(privateKey, header, payload) {
  const h = base64Url(JSON.stringify(header));
  const p = base64Url(JSON.stringify(payload));
  const signingInput = `${h}.${p}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = base64Url(signer.sign(privateKey));
  return `${signingInput}.${signature}`;
}

function makeKeyPair(kid) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" });
  return {
    kid,
    jwk: { kty: "RSA", kid, alg: "RS256", use: "sig", n: jwk.n, e: jwk.e },
    privateKey,
  };
}

function installFetchStub(jwksResponses) {
  let callCount = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    callCount += 1;
    const payload = typeof jwksResponses === "function"
      ? jwksResponses(url, callCount)
      : jwksResponses;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return payload;
      },
    };
  };
  return {
    restore() {
      globalThis.fetch = original;
    },
    get calls() {
      return callCount;
    },
  };
}

function clearModuleJwksCache() {
  // The verifier stores its cache on globalThis under a known key.
  const cacheKey = "__jkn_cf_access_jwks_cache__";
  const inflightKey = "__jkn_cf_access_jwks_inflight__";
  if (globalThis[cacheKey]) globalThis[cacheKey].clear();
  if (globalThis[inflightKey]) globalThis[inflightKey].clear();
}

test("cf-access: verifies a valid user JWT and returns email identity", async () => {
  clearModuleJwksCache();
  const key = makeKeyPair("kid-user-1");
  const stub = installFetchStub({ keys: [key.jwk] });
  try {
    const now = Math.floor(Date.now() / 1000);
    const jwt = signJwt(
      key.privateKey,
      { alg: "RS256", kid: key.kid, typ: "JWT" },
      {
        iss: `https://${TEAM_DOMAIN}`,
        aud: AUD,
        email: "Alice@Example.COM",
        iat: now,
        exp: now + 300,
      },
    );
    const identity = await verifyCloudflareAccessJwt(jwt, {
      teamDomain: TEAM_DOMAIN,
      audience: AUD,
    });
    assert.equal(identity.kind, "user");
    assert.equal(identity.email, "alice@example.com");
    assert.equal(identity.subject, "alice@example.com");
  } finally {
    stub.restore();
  }
});

test("cf-access: resolves service tokens via common_name", async () => {
  clearModuleJwksCache();
  const key = makeKeyPair("kid-svc-1");
  const stub = installFetchStub({ keys: [key.jwk] });
  try {
    const now = Math.floor(Date.now() / 1000);
    const jwt = signJwt(
      key.privateKey,
      { alg: "RS256", kid: key.kid, typ: "JWT" },
      {
        iss: `https://${TEAM_DOMAIN}`,
        aud: AUD,
        common_name: "tauri-workspace.service.jinkunchen.com",
        iat: now,
        exp: now + 300,
      },
    );
    const identity = await verifyCloudflareAccessJwt(jwt, {
      teamDomain: TEAM_DOMAIN,
      audience: AUD,
    });
    assert.equal(identity.kind, "service");
    assert.equal(identity.email, "");
    assert.equal(identity.subject, "tauri-workspace.service.jinkunchen.com");
  } finally {
    stub.restore();
  }
});

test("cf-access: rejects wrong audience", async () => {
  clearModuleJwksCache();
  const key = makeKeyPair("kid-aud-1");
  const stub = installFetchStub({ keys: [key.jwk] });
  try {
    const now = Math.floor(Date.now() / 1000);
    const jwt = signJwt(
      key.privateKey,
      { alg: "RS256", kid: key.kid, typ: "JWT" },
      {
        iss: `https://${TEAM_DOMAIN}`,
        aud: "some-other-aud",
        email: "bob@example.com",
        iat: now,
        exp: now + 300,
      },
    );
    await assert.rejects(
      () =>
        verifyCloudflareAccessJwt(jwt, {
          teamDomain: TEAM_DOMAIN,
          audience: AUD,
        }),
      CloudflareAccessVerifyError,
    );
  } finally {
    stub.restore();
  }
});

test("cf-access: rejects wrong issuer", async () => {
  clearModuleJwksCache();
  const key = makeKeyPair("kid-iss-1");
  const stub = installFetchStub({ keys: [key.jwk] });
  try {
    const now = Math.floor(Date.now() / 1000);
    const jwt = signJwt(
      key.privateKey,
      { alg: "RS256", kid: key.kid, typ: "JWT" },
      {
        iss: `https://attacker.cloudflareaccess.com`,
        aud: AUD,
        email: "x@example.com",
        iat: now,
        exp: now + 300,
      },
    );
    await assert.rejects(
      () =>
        verifyCloudflareAccessJwt(jwt, {
          teamDomain: TEAM_DOMAIN,
          audience: AUD,
        }),
      CloudflareAccessVerifyError,
    );
  } finally {
    stub.restore();
  }
});

test("cf-access: rejects expired tokens", async () => {
  clearModuleJwksCache();
  const key = makeKeyPair("kid-exp-1");
  const stub = installFetchStub({ keys: [key.jwk] });
  try {
    const now = Math.floor(Date.now() / 1000);
    const jwt = signJwt(
      key.privateKey,
      { alg: "RS256", kid: key.kid, typ: "JWT" },
      {
        iss: `https://${TEAM_DOMAIN}`,
        aud: AUD,
        email: "stale@example.com",
        iat: now - 3600,
        exp: now - 60,
      },
    );
    await assert.rejects(
      () =>
        verifyCloudflareAccessJwt(jwt, {
          teamDomain: TEAM_DOMAIN,
          audience: AUD,
        }),
      CloudflareAccessVerifyError,
    );
  } finally {
    stub.restore();
  }
});

test("cf-access: rejects signatures signed by an untrusted key", async () => {
  clearModuleJwksCache();
  const trusted = makeKeyPair("kid-trust-1");
  const attacker = makeKeyPair("kid-trust-1"); // same kid, different key
  const stub = installFetchStub({ keys: [trusted.jwk] });
  try {
    const now = Math.floor(Date.now() / 1000);
    const forged = signJwt(
      attacker.privateKey,
      { alg: "RS256", kid: trusted.kid, typ: "JWT" },
      {
        iss: `https://${TEAM_DOMAIN}`,
        aud: AUD,
        email: "mallory@example.com",
        iat: now,
        exp: now + 300,
      },
    );
    await assert.rejects(
      () =>
        verifyCloudflareAccessJwt(forged, {
          teamDomain: TEAM_DOMAIN,
          audience: AUD,
        }),
      CloudflareAccessVerifyError,
    );
  } finally {
    stub.restore();
  }
});

test("cf-access: JWKS is cached across calls (only one fetch within TTL)", async () => {
  clearModuleJwksCache();
  const key = makeKeyPair("kid-cache-1");
  const stub = installFetchStub({ keys: [key.jwk] });
  try {
    const now = Math.floor(Date.now() / 1000);
    const jwt = signJwt(
      key.privateKey,
      { alg: "RS256", kid: key.kid, typ: "JWT" },
      {
        iss: `https://${TEAM_DOMAIN}`,
        aud: AUD,
        email: "c1@example.com",
        iat: now,
        exp: now + 300,
      },
    );
    await verifyCloudflareAccessJwt(jwt, {
      teamDomain: TEAM_DOMAIN,
      audience: AUD,
    });
    await verifyCloudflareAccessJwt(jwt, {
      teamDomain: TEAM_DOMAIN,
      audience: AUD,
    });
    await verifyCloudflareAccessJwt(jwt, {
      teamDomain: TEAM_DOMAIN,
      audience: AUD,
    });
    assert.equal(stub.calls, 1, `jwks should be fetched once; got ${stub.calls}`);
  } finally {
    stub.restore();
  }
});

test("cf-access: verifyCloudflareAccessFromHeaders returns null when header missing", async () => {
  const headers = new Headers({ "content-type": "application/json" });
  const result = await verifyCloudflareAccessFromHeaders(headers, {
    teamDomain: TEAM_DOMAIN,
    audience: AUD,
  });
  assert.equal(result, null);
});

test("cf-access: readCloudflareAccessConfigFromEnv returns null for partial env", () => {
  const config = readCloudflareAccessConfigFromEnv({
    CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    // no CF_ACCESS_AUD
  });
  assert.equal(config, null);

  const config2 = readCloudflareAccessConfigFromEnv({
    CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    CF_ACCESS_AUD: "abc",
  });
  assert.ok(config2);
  assert.equal(config2.teamDomain, "example.cloudflareaccess.com");
  assert.equal(config2.audience, "abc");
});
