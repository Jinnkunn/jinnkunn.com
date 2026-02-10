import crypto from "node:crypto";

/**
 * @param {string} input
 * @returns {string}
 */
export function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input || "")).digest("hex");
}

