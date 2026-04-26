// Generic text-file store used by site-admin CRUD endpoints (MDX posts/pages).
// Two backends implement the `ContentStore` interface:
//   - "local": reads/writes files under <repoRoot>/content/...  (dev)
//   - "github": reads/writes via GitHub Contents API            (staging/prod)
//
// The backend picker lives in `content-store-resolver.ts` so this module stays
// dependency-free (doesn't pull in node:crypto / GitHub client).

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type ContentVersion = string; // sha1 of file bytes, used for if-match

export class ContentStoreConflictError extends Error {
  readonly expected: ContentVersion | null;
  readonly actual: ContentVersion | null;
  constructor(input: { expected: ContentVersion | null; actual: ContentVersion | null }) {
    super(
      `content store: version mismatch (expected ${input.expected ?? "null"}, actual ${
        input.actual ?? "null"
      })`,
    );
    this.name = "ContentStoreConflictError";
    this.expected = input.expected;
    this.actual = input.actual;
  }
}

export class ContentStoreNotFoundError extends Error {
  readonly relPath: string;
  constructor(relPath: string) {
    super(`content store: path not found: ${relPath}`);
    this.name = "ContentStoreNotFoundError";
    this.relPath = relPath;
  }
}

export type ContentEntry = {
  name: string; // basename, e.g. "hello-world.mdx"
  relPath: string; // path relative to content root, e.g. "posts/hello-world.mdx"
  sha: ContentVersion;
  size: number;
};

export interface ContentStore {
  listFiles(dirRel: string, opts?: { recursive?: boolean }): Promise<ContentEntry[]>;
  readFile(relPath: string): Promise<{ content: string; sha: ContentVersion } | null>;
  writeFile(
    relPath: string,
    content: string,
    opts?: { ifMatch?: ContentVersion | null; commitMessage?: string },
  ): Promise<{ sha: ContentVersion }>;
  writeBinary(
    relPath: string,
    data: Uint8Array,
    opts?: { ifMatch?: ContentVersion | null; commitMessage?: string },
  ): Promise<{ sha: ContentVersion }>;
  readBinary(
    relPath: string,
  ): Promise<{ data: Uint8Array; sha: ContentVersion } | null>;
  deleteFile(
    relPath: string,
    opts?: { ifMatch?: ContentVersion | null; commitMessage?: string },
  ): Promise<void>;
}

function sha1Hex(input: string): string {
  return createHash("sha1").update(input, "utf8").digest("hex");
}

function sha1HexBytes(input: Uint8Array): string {
  return createHash("sha1").update(input).digest("hex");
}

function normalizeRel(relPath: string): string {
  const normalized = path.posix.normalize(relPath.replace(/^\/+/, ""));
  if (
    !normalized ||
    normalized.startsWith("..") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..")
  ) {
    throw new Error(`content store: invalid path: ${relPath}`);
  }
  return normalized;
}

export function createLocalContentStore(opts?: { rootDir?: string }): ContentStore {
  const root = opts?.rootDir ?? path.join(process.cwd(), "content");

  const resolve = (rel: string): string => {
    const normalized = normalizeRel(rel);
    return path.join(root, normalized);
  };

  async function readExisting(full: string): Promise<{ content: string; sha: string } | null> {
    try {
      const content = await fs.readFile(full, "utf8");
      return { content, sha: sha1Hex(content) };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw err;
    }
  }

  return {
    async listFiles(dirRel: string, opts?: { recursive?: boolean }): Promise<ContentEntry[]> {
      const normalized = normalizeRel(dirRel);
      const out: ContentEntry[] = [];

      async function walk(dir: string): Promise<void> {
        const dirFull = path.join(root, dir);
        let names: string[];
        try {
          names = await fs.readdir(dirFull);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ENOENT") return;
          throw err;
        }
        for (const name of names) {
          const relPath = path.posix.join(dir, name);
          const full = path.join(dirFull, name);
          const stat = await fs.stat(full);
          if (stat.isDirectory()) {
            if (opts?.recursive) await walk(relPath);
            continue;
          }
          if (!stat.isFile()) continue;
          const bytes = await fs.readFile(full);
          out.push({
            name,
            relPath,
            sha: sha1HexBytes(bytes),
            size: bytes.byteLength,
          });
        }
      }

      await walk(normalized);
      out.sort((a, b) => a.name.localeCompare(b.name));
      return out;
    },

    async readFile(relPath: string): Promise<{ content: string; sha: ContentVersion } | null> {
      const full = resolve(relPath);
      return readExisting(full);
    },

    async writeFile(
      relPath: string,
      content: string,
      opts?: { ifMatch?: ContentVersion | null },
    ): Promise<{ sha: ContentVersion }> {
      const full = resolve(relPath);
      const existing = await readExisting(full);
      if (opts?.ifMatch !== undefined) {
        const expected = opts.ifMatch;
        const actual = existing?.sha ?? null;
        const isCreate = expected === null || expected === "";
        if (isCreate && actual !== null) {
          throw new ContentStoreConflictError({ expected, actual });
        }
        if (!isCreate && expected !== actual) {
          throw new ContentStoreConflictError({ expected, actual });
        }
      }
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, "utf8");
      return { sha: sha1Hex(content) };
    },

    async writeBinary(
      relPath: string,
      data: Uint8Array,
      opts?: { ifMatch?: ContentVersion | null },
    ): Promise<{ sha: ContentVersion }> {
      const full = resolve(relPath);
      // Read existing as raw bytes to compute current sha.
      let existingSha: string | null = null;
      try {
        const buf = await fs.readFile(full);
        existingSha = sha1HexBytes(buf);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw err;
      }
      if (opts?.ifMatch !== undefined) {
        const expected = opts.ifMatch;
        const isCreate = expected === null || expected === "";
        if (isCreate && existingSha !== null) {
          throw new ContentStoreConflictError({ expected, actual: existingSha });
        }
        if (!isCreate && expected !== existingSha) {
          throw new ContentStoreConflictError({ expected, actual: existingSha });
        }
      }
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, data);
      return { sha: sha1HexBytes(data) };
    },

    async readBinary(
      relPath: string,
    ): Promise<{ data: Uint8Array; sha: ContentVersion } | null> {
      const full = resolve(relPath);
      try {
        const buf = await fs.readFile(full);
        const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        return { data: bytes, sha: sha1HexBytes(bytes) };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return null;
        throw err;
      }
    },

    async deleteFile(
      relPath: string,
      opts?: { ifMatch?: ContentVersion | null },
    ): Promise<void> {
      const full = resolve(relPath);
      const existing = await readExisting(full);
      if (!existing) throw new ContentStoreNotFoundError(relPath);
      if (opts?.ifMatch !== undefined && opts.ifMatch !== null) {
        if (opts.ifMatch !== existing.sha) {
          throw new ContentStoreConflictError({ expected: opts.ifMatch, actual: existing.sha });
        }
      }
      await fs.unlink(full);
    },
  };
}

// Picker lives in content-store-resolver.ts to avoid a circular import loop
// (github-content-store depends on types/classes exported from this module).
