import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const DEFAULT_NEXTAUTH_SECRET = "codex-design-system-qa-secret";

export function hasNextBuild(root = process.cwd()) {
  return fs.existsSync(path.join(root, ".next", "BUILD_ID"));
}

export function ensureNextBuild(root = process.cwd(), options = {}) {
  if (!options.force && hasNextBuild(root)) return;
  const result = spawnSync("npm", ["run", "build"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error("Build failed; cannot start Next production server.");
  }
}

export async function findAvailablePort(preferredPort) {
  const requested = Number.parseInt(String(preferredPort || ""), 10);
  if (Number.isFinite(requested) && requested > 0) return requested;

  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Could not allocate a local port."));
      });
    });
  });
}

export function startNextServer({ root = process.cwd(), port }) {
  const child = spawn("npm", ["run", "start", "--", "-p", String(port)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(port),
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || DEFAULT_NEXTAUTH_SECRET,
      NEXTAUTH_URL: process.env.NEXTAUTH_URL || `http://127.0.0.1:${port}`,
    },
  });

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs = `${logs}${String(chunk)}`.slice(-40_000);
  });
  child.stderr.on("data", (chunk) => {
    logs = `${logs}${String(chunk)}`.slice(-40_000);
  });
  child.getLogs = () => logs;
  return child;
}

export async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForHttp(url, timeoutMs = 45_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status >= 200 && res.status < 500) return res;
    } catch {
      // keep polling
    }
    await sleep(350);
  }
  throw new Error(`Server not ready: ${url}`);
}
