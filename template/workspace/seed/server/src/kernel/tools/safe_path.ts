import path from "node:path";
import fs from "node:fs/promises";

// Resolve a relative path within a root, with detailed error codes.
export type SafePathResult =
  | { ok: true; absPath: string }
  | {
      ok: false;
      code:
        | "PATH_ABSOLUTE"
        | "PATH_TRAVERSAL"
        | "PATH_OUTSIDE_ROOT"
        | "PATH_SYMLINK_ESCAPE"
        | "PATH_ANCESTOR_MISSING";
      details: unknown;
    };

function isWindowsAbs(p: string) {
  // Accept both drive-letter and UNC path syntaxes.
  return /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p);
}

function normalizeRel(p: string) {
  // Normalize to POSIX separators to simplify traversal checks.
  return path.posix.normalize(p.replaceAll("\\", "/"));
}

function hasDotDot(normRel: string) {
  // Detect any parent directory traversal sequences.
  return normRel === ".." || normRel.startsWith("../") || normRel.includes("/../");
}

async function pathExists(p: string) {
  // Non-throwing existence check.
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function resolvePathWithinRoot(opts: {
  allowedRootAbs: string;
  relativePath: string;
}): Promise<SafePathResult> {
  const { allowedRootAbs, relativePath } = opts;

  // Absolute paths are rejected (including Windows-style paths).
  if (path.isAbsolute(relativePath) || isWindowsAbs(relativePath)) {
    return { ok: false, code: "PATH_ABSOLUTE", details: { relativePath } };
  }

  const normRel = normalizeRel(relativePath);
  if (hasDotDot(normRel)) {
    return { ok: false, code: "PATH_TRAVERSAL", details: { relativePath, normRel } };
  }

  const candidateAbs = path.resolve(allowedRootAbs, normRel);

  let ancestor = candidateAbs;
  // Walk up to find an existing ancestor for realpath checks.
  while (!(await pathExists(ancestor))) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      break;
    }
    ancestor = parent;
    if (ancestor === allowedRootAbs) {
      break;
    }
  }

  if (!(await pathExists(allowedRootAbs))) {
    return { ok: false, code: "PATH_ANCESTOR_MISSING", details: { allowedRootAbs } };
  }

  let ancestorReal: string;
  try {
    ancestorReal = await fs.realpath(ancestor);
  } catch {
    return {
      ok: false,
      code: "PATH_SYMLINK_ESCAPE",
      details: { relativePath, ancestor, reason: "Cannot realpath nearest ancestor" }
    };
  }

  const rootWithSep = allowedRootAbs.endsWith(path.sep)
    ? allowedRootAbs
    : allowedRootAbs + path.sep;
  const ancWithSep = ancestorReal.endsWith(path.sep) ? ancestorReal : ancestorReal + path.sep;

  if (!ancWithSep.startsWith(rootWithSep) && ancestorReal !== allowedRootAbs) {
    return {
      ok: false,
      code: "PATH_OUTSIDE_ROOT",
      details: { relativePath, ancestorReal, allowedRootAbs }
    };
  }

  return { ok: true, absPath: candidateAbs };
}
