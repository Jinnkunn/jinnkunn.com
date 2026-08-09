import { describe, expect, it } from "vitest";

import { isUntrustedHostRejection } from "./api";
import { classifySiteAdminError, isNetworkError } from "./api-errors";

// The Rust host allowlist refuses a credentialed call by returning Err, which
// reaches the webview as a thrown invoke error — the same shape a real network
// failure produces. If the request layer can't tell them apart, the refusal
// gets queued into the write outbox and replayed at the same bad host, turning
// the security control into the trigger for the bypass.
describe("isUntrustedHostRejection", () => {
  it("recognizes the transport and outbox allowlist refusals", () => {
    expect(
      isUntrustedHostRejection(
        "refusing to send Site Admin credentials to untrusted host: evil.example.com",
      ),
    ).toBe(true);
    expect(
      isUntrustedHostRejection(
        "outbox_enqueue: refusing to queue/replay Site Admin credentials for untrusted host: evil.example.com",
      ),
    ).toBe(true);
  });

  it("leaves genuine network failures classified as offline", () => {
    for (const message of [
      "HTTP request failed: error sending request for url (https://staging.jinkunchen.com/api)",
      "error trying to connect: dns error",
      "Missing base_url",
    ]) {
      expect(isUntrustedHostRejection(message)).toBe(false);
    }
  });
});

describe("classifySiteAdminError for UNTRUSTED_HOST", () => {
  // The host name is attacker-influenced text; it must not be able to steer
  // the classifier into the retryable "network" bucket by containing a word
  // the network heuristic looks for.
  const response = {
    ok: false as const,
    status: 0,
    code: "UNTRUSTED_HOST",
    error:
      "refusing to send Site Admin credentials to untrusted host: network-fetch.example.com",
    raw: null,
  };

  it("is a non-retryable configuration error, never a network error", () => {
    const info = classifySiteAdminError(response, { action: "Save" });
    expect(info.category).toBe("validation");
    expect(info.retryable).toBe(false);
    expect(isNetworkError(response)).toBe(false);
  });
});
