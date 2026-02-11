import path from "node:path";
import fs from "node:fs/promises";

export type AbsPath = string;

export const DEFAULT_DENY_GLOBS = [
  ".git/**",
  "node_modules/**",
  ".env",
  ".env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.crt",
  "**/*.p12",
  "**/*.pfx",
  "**/.DS_Store"
];

export const DEFAULT_LIST_DENY_GLOBS = [
  "!**/.git/**",
  "!**/node_modules/**",
  "!**/seed/**",
  "!**/state/**",
  "!**/.harness/**"
];

export async function realpathSafe(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      const parent = path.dirname(p);
      const parentReal = await fs.realpath(parent);
      return path.join(parentReal, path.basename(p));
    }
    throw error;
  }
}

export function resolveWithinRoot(rootAbs: AbsPath, userPath: string): AbsPath {
  if (path.isAbsolute(userPath)) {
    throw new Error(`Absolute paths forbidden: ${userPath}`);
  }
  const resolved = path.resolve(rootAbs, userPath);
  const rel = path.relative(rootAbs, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes root: ${userPath}`);
  }
  return resolved;
}

export async function ensureParentDirInsideRoot(
  rootAbs: AbsPath,
  targetAbs: AbsPath
): Promise<void> {
  const parent = path.dirname(targetAbs);
  const parentReal = await realpathSafe(parent);
  const rootReal = await fs.realpath(rootAbs);
  const rel = path.relative(rootReal, parentReal);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Symlink escape via parent dir: ${targetAbs}`);
  }
}
