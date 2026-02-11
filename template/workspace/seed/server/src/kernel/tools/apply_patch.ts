import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import picomatch from "picomatch";
import {
  DEFAULT_DENY_GLOBS,
  ensureParentDirInsideRoot,
  resolveWithinRoot
} from "./path_safety.js";
import { runGit } from "./git_utils.js";
import type { ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";

export type ApplyPatchArgs = {
  root: string;
  unifiedDiff: string;
  dryRun?: boolean;
  maxFiles?: number;
  maxBytes?: number;
  denyGlobs?: string[];
  allowGlobs?: string[];
};

export type ApplyPatchResult = {
  applied: boolean;
  filesChanged: string[];
  stats: { insertions: number; deletions: number };
};

export const spec: ToolSpec = {
  name: "apply_patch",
  description: "Apply a unified diff safely within a root directory.",
  argsSchema: {
    type: "object",
    properties: {
      root: { type: "string", description: "Root directory (absolute or relative to workspace)." },
      unifiedDiff: { type: "string", description: "Unified diff text." },
      dryRun: { type: "boolean", description: "Validate without applying." },
      maxFiles: { type: "number", description: "Maximum files the diff may touch." },
      maxBytes: { type: "number", description: "Maximum diff size in bytes." },
      denyGlobs: { type: "array", items: { type: "string" }, description: "Denied path globs." },
      allowGlobs: { type: "array", items: { type: "string" }, description: "Allowed path globs." }
    },
    required: ["root", "unifiedDiff"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      applied: { type: "boolean" },
      filesChanged: { type: "array", items: { type: "string" } },
      stats: {
        type: "object",
        properties: {
          insertions: { type: "number" },
          deletions: { type: "number" }
        },
        required: ["insertions", "deletions"],
        additionalProperties: false
      }
    },
    required: ["applied", "filesChanged", "stats"],
    additionalProperties: false
  },
  examples: [
    {
      input: { root: "projects/demo", unifiedDiff: "diff --git a/a b/a\n" },
      output: { ok: true, result: { applied: false, filesChanged: [], stats: { insertions: 0, deletions: 0 } } }
    }
  ],
  tags: ["patch", "git", "apply"],
  filePath: "seed/server/src/kernel/tools/apply_patch.ts"
};

function extractPatchedFiles(diff: string): string[] {
  const files = new Set<string>();
  const lines = diff.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4).trim();
      if (!raw || raw === "/dev/null") {
        continue;
      }
      const cleaned = raw.startsWith("b/") ? raw.slice(2) : raw;
      files.add(cleaned.replace(/\\/g, "/"));
    }
  }
  return Array.from(files);
}

function matchesAny(patterns: string[] | undefined, target: string): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }
  return picomatch.isMatch(target, patterns, { dot: true });
}

export async function applyPatch(
  args: ApplyPatchArgs
): Promise<ToolResult<ApplyPatchResult>> {
  try {
    const rootAbs = path.resolve(args.root);
    const maxBytes = args.maxBytes ?? 1_000_000;
    const maxFiles = args.maxFiles ?? 50;

    const st = await fs.stat(rootAbs).catch(() => null);
    if (!st || !st.isDirectory()) {
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: `Root not found or not a directory: ${args.root}` }
      };
    }

    if (Buffer.byteLength(args.unifiedDiff, "utf-8") > maxBytes) {
      return { ok: false, error: { code: "TOO_LARGE", message: "Diff exceeds maxBytes" } };
    }

    const files = extractPatchedFiles(args.unifiedDiff);
    if (files.length === 0) {
      return {
        ok: false,
        error: { code: "INVALID_ARGS", message: "No files detected in diff" }
      };
    }
    if (files.length > maxFiles) {
      return {
        ok: false,
        error: {
          code: "TOO_LARGE",
          message: `Diff touches too many files: ${files.length}`
        }
      };
    }

    const deny = args.denyGlobs ?? DEFAULT_DENY_GLOBS;
    const allow = args.allowGlobs;

    for (const rel of files) {
      const abs = resolveWithinRoot(rootAbs, rel);
      await ensureParentDirInsideRoot(rootAbs, abs);

      if (matchesAny(deny, rel)) {
        return {
          ok: false,
          error: { code: "NOT_ALLOWED", message: `Patch touches denied path: ${rel}` }
        };
      }
      if (allow && !matchesAny(allow, rel)) {
        return {
          ok: false,
          error: { code: "NOT_ALLOWED", message: `Patch touches non-allowed path: ${rel}` }
        };
      }
    }

    const gitCheck = await runGit(["rev-parse", "--git-dir"], rootAbs);
    if (gitCheck.code !== 0) {
      return { ok: false, error: { code: "PRECONDITION_FAILED", message: "Git repository not found" } };
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "seed-patch-"));
    const patchPath = path.join(tmpDir, "change.patch");
    await fs.writeFile(patchPath, args.unifiedDiff, "utf-8");

    const check = await runGit(["apply", "--check", "--whitespace=nowarn", patchPath], rootAbs);
    if (check.code !== 0) {
      return {
        ok: false,
        error: {
          code: "PATCH_APPLY_FAILED",
          message: "Patch does not apply cleanly",
          details: check.stderr
        }
      };
    }

    if (args.dryRun) {
      return {
        ok: true,
        result: { applied: false, filesChanged: files, stats: { insertions: 0, deletions: 0 } },
        warnings: ["dryRun=true"]
      };
    }

    const apply = await runGit(
      ["apply", "--index", "--3way", "--whitespace=nowarn", patchPath],
      rootAbs
    );
    if (apply.code !== 0) {
      return {
        ok: false,
        error: {
          code: "PATCH_APPLY_FAILED",
          message: "Patch apply failed",
          details: apply.stderr
        }
      };
    }

    const numstat = await runGit(["diff", "--cached", "--numstat"], rootAbs);
    let insertions = 0;
    let deletions = 0;
    if (numstat.code === 0) {
      for (const line of numstat.stdout.split("\n")) {
        if (!line.trim()) {
          continue;
        }
        const [ins, del] = line.split("\t");
        const insNum = Number(ins);
        const delNum = Number(del);
        if (Number.isFinite(insNum)) {
          insertions += insNum;
        }
        if (Number.isFinite(delNum)) {
          deletions += delNum;
        }
      }
    }

    return {
      ok: true,
      result: { applied: true, filesChanged: files, stats: { insertions, deletions } }
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: error instanceof Error ? error.message : "apply_patch failed",
        details: error
      }
    };
  }
}
