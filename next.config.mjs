import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Avoid Next.js incorrectly inferring the repo root due to other lockfiles on the machine.
  outputFileTracingRoot: path.resolve("."),
  turbopack: {
    root: path.resolve("."),
  },
};

export default nextConfig;

