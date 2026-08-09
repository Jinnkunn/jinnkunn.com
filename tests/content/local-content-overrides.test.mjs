import assert from "node:assert/strict";
import test from "node:test";

const MODULE = "../../lib/server/local-content-overrides.ts";

async function load() {
  // Re-import fresh so the one-shot warning flag is per-test.
  const mod = await import(`${MODULE}?t=${Math.random().toString(36).slice(2)}`);
  return mod;
}

function withEnv(overrides, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("explicit opt-out wins over NODE_ENV=development", async () => {
  const { localContentOverridesEnabled } = await load();
  withEnv({ SITE_CONTENT_LOCAL_OVERRIDES: "0", NODE_ENV: "development" }, () => {
    assert.equal(localContentOverridesEnabled(), false);
  });
  withEnv({ SITE_CONTENT_LOCAL_OVERRIDES: "false", NODE_ENV: "development" }, () => {
    assert.equal(localContentOverridesEnabled(), false);
  });
});

test("explicit opt-in wins outside development", async () => {
  const { localContentOverridesEnabled } = await load();
  withEnv({ SITE_CONTENT_LOCAL_OVERRIDES: "1", NODE_ENV: "production" }, () => {
    assert.equal(localContentOverridesEnabled(), true);
  });
});

test("production never silently enables local overrides", async () => {
  const { localContentOverridesEnabled } = await load();
  withEnv({ SITE_CONTENT_LOCAL_OVERRIDES: undefined, NODE_ENV: "production" }, () => {
    assert.equal(localContentOverridesEnabled(), false);
  });
});

test("the implied development default announces the gitignored write target exactly once", async () => {
  const { localContentOverridesEnabled, resetLocalContentOverridesWarning } = await load();
  resetLocalContentOverridesWarning();

  const messages = [];
  const original = console.warn;
  console.warn = (...args) => messages.push(args.join(" "));
  try {
    withEnv({ SITE_CONTENT_LOCAL_OVERRIDES: undefined, NODE_ENV: "development" }, () => {
      assert.equal(localContentOverridesEnabled(), true);
      assert.equal(localContentOverridesEnabled(), true);
    });
  } finally {
    console.warn = original;
  }

  assert.equal(messages.length, 1, "the warning must not repeat on every call");
  assert.match(messages[0], /content\/local\//);
  assert.match(messages[0], /SITE_CONTENT_LOCAL_OVERRIDES=0/);
});
