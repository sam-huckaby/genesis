import path from "node:path";
import fs from "node:fs/promises";

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
  return /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p);
}

function normalizeRel(p: string) {
  return path.posix.normalize(p.replaceAll("\\", "/"));
}

function hasDotDot(normRel: string) {
  return normRel === ".." || normRel.startsWith("../") || normRel.includes("/../");
}

async function pathExists(p: string) {
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

  if (path.isAbsolute(relativePath) || isWindowsAbs(relativePath)) {
    return { ok: false, code: "PATH_ABSOLUTE", details: { relativePath } };
  }

  const normRel = normalizeRel(relativePath);
  if (hasDotDot(normRel)) {
    return { ok: false, code: "PATH_TRAVERSAL", details: { relativePath, normRel } };
  }

  const candidateAbs = path.resolve(allowedRootAbs, normRel);

  let ancestor = candidateAbs;
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
