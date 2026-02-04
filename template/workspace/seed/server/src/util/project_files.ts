import fs from "node:fs";
import path from "node:path";

const BLOCKED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  "tmp",
  "vendor"
]);

const BLOCKED_FILENAMES = new Set([".env", "id_rsa", "id_ed25519"]);

const BLOCKED_EXTENSIONS = new Set([".pem", ".key", ".crt", ".p12", ".pfx", ".kdbx"]);

export function normalizeRelPath(input: string): string {
  const normalized = path.posix.normalize(input.replace(/\\/g, "/")).replace(/^\.(\/|$)/, "");
  return normalized.length === 0 ? "." : normalized;
}

export function isSensitivePath(relPath: string): boolean {
  const normalized = normalizeRelPath(relPath).toLowerCase();
  if (normalized === ".") {
    return false;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => BLOCKED_DIRS.has(segment))) {
    return true;
  }
  const base = segments[segments.length - 1] ?? "";
  if (BLOCKED_FILENAMES.has(base)) {
    return true;
  }
  if (base.startsWith(".env.")) {
    return true;
  }
  const ext = path.posix.extname(base);
  if (ext && BLOCKED_EXTENSIONS.has(ext)) {
    return true;
  }
  return false;
}

export function listProjectFiles(
  projectRootAbs: string,
  options?: { maxDepth?: number; maxEntries?: number; startPath?: string }
): { files: string[]; truncated: boolean } {
  const maxDepth = options?.maxDepth ?? 6;
  const maxEntries = options?.maxEntries ?? 500;
  const startPath = normalizeRelPath(options?.startPath ?? ".");
  if (startPath.startsWith("..") || path.posix.isAbsolute(startPath)) {
    return { files: [], truncated: false };
  }
  if (isSensitivePath(startPath)) {
    return { files: [], truncated: false };
  }
  const results: string[] = [];

  const queue: { abs: string; rel: string; depth: number }[] = [];
  const startAbs = path.join(projectRootAbs, startPath === "." ? "" : startPath);
  queue.push({ abs: startAbs, rel: startPath === "." ? "" : startPath, depth: 0 });

  while (queue.length > 0 && results.length < maxEntries) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current.abs, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const relPath = current.rel
        ? path.posix.join(current.rel, entry.name)
        : entry.name;
      if (isSensitivePath(relPath)) {
        continue;
      }
      const absPath = path.join(current.abs, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) {
          queue.push({ abs: absPath, rel: relPath, depth: current.depth + 1 });
        }
        continue;
      }
      if (entry.isFile()) {
        results.push(relPath);
        if (results.length >= maxEntries) {
          break;
        }
      }
    }
  }

  return { files: results, truncated: results.length >= maxEntries };
}

export function readProjectFile(
  projectRootAbs: string,
  relPath: string,
  maxBytes = 20000
): { content: string; truncated: boolean } {
  const normalized = normalizeRelPath(relPath);
  if (isSensitivePath(normalized)) {
    throw new Error("Access to sensitive files is blocked");
  }
  if (normalized.startsWith("..") || path.posix.isAbsolute(normalized)) {
    throw new Error("Invalid path");
  }
  const absPath = path.join(projectRootAbs, normalized);
  const stat = fs.statSync(absPath);
  if (!stat.isFile()) {
    throw new Error("Path is not a file");
  }
  const content = fs.readFileSync(absPath, "utf8");
  if (content.length > maxBytes) {
    return { content: content.slice(0, maxBytes), truncated: true };
  }
  return { content, truncated: false };
}

export function diffTouchesSensitivePath(diff: string): boolean {
  const paths = extractDiffPaths(diff);
  return paths.some((p) => isSensitivePath(p));
}

export function extractDiffPaths(diff: string): string[] {
  const paths = new Set<string>();
  const lines = diff.split("\n");
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/a\/(.*?) b\/(.*)$/);
      if (match?.[2]) {
        paths.add(normalizeRelPath(match[2]));
      }
    } else if (line.startsWith("+++ b/")) {
      const raw = line.slice(6).trim();
      if (raw && raw !== "/dev/null") {
        paths.add(normalizeRelPath(raw));
      }
    }
  }
  return Array.from(paths);
}
