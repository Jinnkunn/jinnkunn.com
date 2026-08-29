import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import {
  DocumentConflictError,
  DocumentNotFoundError,
  normalizeDocumentPath,
  type DocumentEntry,
  type DocumentRepository,
  type DocumentRevision,
  type DocumentVersion,
} from "@jinnkunn/document-repository";

const execFileAsync = promisify(execFile);

export type LocalDocumentRepositoryOptions = {
  /** Directory represented by repository path `.` (normally `<repo>/content`). */
  rootDir: string;
  /** Optional git worktree root used for local revision history. */
  gitRootDir?: string;
  /** Path from gitRootDir to rootDir, normally `content`. */
  gitPathPrefix?: string;
};

function sha1Bytes(input: Uint8Array): string {
  return createHash("sha1").update(input).digest("hex");
}

function utf8(input: string): Uint8Array {
  return new Uint8Array(Buffer.from(input, "utf8"));
}

function asUtf8(input: Uint8Array): string {
  return Buffer.from(input).toString("utf8");
}

function assertExpectedVersion(input: {
  expectedVersion: DocumentVersion | null | undefined;
  actualVersion: DocumentVersion | null;
}): void {
  if (input.expectedVersion === undefined) return;
  const creating = input.expectedVersion === null || input.expectedVersion === "";
  if (creating ? input.actualVersion !== null : input.expectedVersion !== input.actualVersion) {
    throw new DocumentConflictError({
      expectedVersion: input.expectedVersion,
      actualVersion: input.actualVersion,
    });
  }
}

export function createLocalDocumentRepository(
  options: LocalDocumentRepositoryOptions,
): DocumentRepository {
  const rootDir = path.resolve(options.rootDir);
  const gitRootDir = options.gitRootDir ? path.resolve(options.gitRootDir) : null;
  const gitPathPrefix = String(options.gitPathPrefix || "").replace(/^\/+|\/+$/g, "");

  const resolve = (input: string): { path: string; fullPath: string } => {
    const documentPath = normalizeDocumentPath(input);
    return { path: documentPath, fullPath: path.join(rootDir, ...documentPath.split("/")) };
  };

  const gitPath = (input: string): string => {
    const documentPath = normalizeDocumentPath(input);
    return gitPathPrefix ? `${gitPathPrefix}/${documentPath}` : documentPath;
  };

  async function readBytes(input: string): Promise<{
    path: string;
    data: Uint8Array;
    version: string;
  } | null> {
    const resolved = resolve(input);
    try {
      const data = await fs.readFile(resolved.fullPath);
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      return { path: resolved.path, data: bytes, version: sha1Bytes(bytes) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async function writeBytes(
    input: string,
    data: Uint8Array,
    expectedVersion: DocumentVersion | null | undefined,
  ) {
    const resolved = resolve(input);
    const existing = await readBytes(resolved.path);
    assertExpectedVersion({
      expectedVersion,
      actualVersion: existing?.version ?? null,
    });
    const version = sha1Bytes(data);
    if (existing?.version !== version) {
      await fs.mkdir(path.dirname(resolved.fullPath), { recursive: true });
      await fs.writeFile(resolved.fullPath, data);
    }
    return { path: resolved.path, version, state: "committed" as const };
  }

  async function listHistory(input: string, limit = 12): Promise<DocumentRevision[]> {
    if (!gitRootDir) return [];
    const maxCount = Math.max(1, Math.min(50, Math.floor(limit)));
    try {
      const { stdout } = await execFileAsync(
        "git",
        [
          "log",
          `--max-count=${maxCount}`,
          "--format=%H%x1f%h%x1f%ct%x1f%an%x1f%s",
          "--",
          gitPath(input),
        ],
        { cwd: gitRootDir, maxBuffer: 1024 * 1024 },
      );
      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [version, shortVersion, epoch, actor, ...message] = line.split("\x1f");
          const timestampMs = Number(epoch) * 1000;
          return {
            version: version || "",
            shortVersion: shortVersion || (version || "").slice(0, 7),
            createdAt: Number.isFinite(timestampMs)
              ? new Date(timestampMs).toISOString()
              : null,
            actor: actor || "",
            message: message.join("\x1f") || "",
          };
        })
        .filter((entry) => Boolean(entry.version));
    } catch {
      return [];
    }
  }

  return {
    kind: "filesystem",

    async list(prefix, listOptions) {
      const normalizedPrefix = normalizeDocumentPath(prefix);
      const out: DocumentEntry[] = [];

      async function walk(directoryPath: string): Promise<void> {
        const directory = resolve(directoryPath);
        let names: string[];
        try {
          names = await fs.readdir(directory.fullPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
          throw error;
        }
        for (const name of names) {
          const documentPath = normalizeDocumentPath(`${directoryPath}/${name}`);
          const resolved = resolve(documentPath);
          const stat = await fs.stat(resolved.fullPath);
          if (stat.isDirectory()) {
            if (listOptions?.recursive) await walk(documentPath);
            continue;
          }
          if (!stat.isFile()) continue;
          const data = await fs.readFile(resolved.fullPath);
          out.push({
            name,
            path: documentPath,
            version: sha1Bytes(data),
            size: data.byteLength,
            updatedAt: stat.mtimeMs,
          });
        }
      }

      await walk(normalizedPrefix);
      out.sort((left, right) => left.path.localeCompare(right.path));
      return out;
    },

    async stat(input) {
      const resolved = resolve(input);
      try {
        const stat = await fs.stat(resolved.fullPath);
        if (!stat.isFile()) return { exists: false };
        const data = await fs.readFile(resolved.fullPath);
        return {
          exists: true,
          size: stat.size,
          updatedAt: stat.mtimeMs,
          version: sha1Bytes(data),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
        // Workerd's bundled fs can sometimes read a file it cannot stat.
        const existing = await readBytes(resolved.path).catch(() => null);
        return existing
          ? { exists: true, size: existing.data.byteLength, version: existing.version }
          : { exists: false };
      }
    },

    async readText(input) {
      const document = await readBytes(input);
      return document
        ? { path: document.path, content: asUtf8(document.data), version: document.version }
        : null;
    },

    async readBinary(input) {
      return readBytes(input);
    },

    async writeText(input, content, writeOptions) {
      return writeBytes(input, utf8(content), writeOptions?.expectedVersion);
    },

    async writeBinary(input, data, writeOptions) {
      return writeBytes(input, data, writeOptions?.expectedVersion);
    },

    async delete(input, writeOptions) {
      const resolved = resolve(input);
      const existing = await readBytes(resolved.path);
      if (!existing) throw new DocumentNotFoundError(resolved.path);
      assertExpectedVersion({
        expectedVersion: writeOptions?.expectedVersion,
        actualVersion: existing.version,
      });
      await fs.unlink(resolved.fullPath);
      return { path: resolved.path, version: existing.version, state: "committed" };
    },

    listHistory,

    async readRevision(input, version) {
      if (!gitRootDir || !/^[a-f0-9]{7,40}$/i.test(version)) return null;
      const documentPath = normalizeDocumentPath(input);
      try {
        const { stdout } = await execFileAsync(
          "git",
          ["show", `${version}:${gitPath(documentPath)}`],
          { cwd: gitRootDir, maxBuffer: 8 * 1024 * 1024 },
        );
        return {
          path: documentPath,
          content: stdout,
          version: sha1Bytes(utf8(stdout)),
        };
      } catch {
        return null;
      }
    },
  };
}
