import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { resolvePathWithinRoot } from "./safe_path.js";
import type { ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";

// Apply unified diffs with safety checks and detailed error reporting.
type PatchErrorCode =
  | "BINARY_PATCH_NOT_SUPPORTED"
  | "MALFORMED_DIFF"
  | "MALFORMED_HUNK_HEADER"
  | "MALFORMED_HUNK_LINE"
  | "HUNK_OUT_OF_BOUNDS"
  | "HUNK_FAILED";

type HunkLine = { kind: " " | "+" | "-"; text: string };
type Hunk = {
  oldStart: number;
  oldLen: number;
  newStart: number;
  newLen: number;
  lines: HunkLine[];
};

type FilePatch = {
  oldPath: string;
  newPath: string;
  hunks: Hunk[];
};

export type ApplyPatchArgs = {
  allowedRootAbs: string;
  patchText: string;
  limits?: {
    maxFiles?: number;
    maxPatchBytes?: number;
    maxFileBytes?: number;
  };
};

export type ApplyPatchResult = {
  summary: {
    filesChanged: number;
    insertions: number;
    deletions: number;
    files: Array<{
      path: string;
      insertions: number;
      deletions: number;
      sha256Before?: string;
      sha256After: string;
    }>;
  };
};

export const spec: ToolSpec = {
  name: "apply_unified_diff",
  description:
    "Apply a unified diff (create/modify only) across multiple files. Use sparingly for large changes.",
  argsSchema: {
    type: "object",
    properties: {
      patchText: { type: "string", description: "Unified diff text." },
      limits: {
        type: "object",
        properties: {
          maxFiles: { type: "number" },
          maxPatchBytes: { type: "number" },
          maxFileBytes: { type: "number" }
        },
        additionalProperties: false
      }
    },
    required: ["patchText"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      summary: {
        type: "object",
        properties: {
          filesChanged: { type: "number" },
          insertions: { type: "number" },
          deletions: { type: "number" },
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                insertions: { type: "number" },
                deletions: { type: "number" },
                sha256Before: { type: "string" },
                sha256After: { type: "string" }
              },
              required: ["path", "insertions", "deletions", "sha256After"],
              additionalProperties: false
            }
          }
        },
        required: ["filesChanged", "insertions", "deletions", "files"],
        additionalProperties: false
      },
      error: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          hint: { type: "string" }
        },
        required: ["code", "message"],
        additionalProperties: false
      }
    },
    required: ["ok"],
    additionalProperties: false
  },
  examples: [
    {
      input: { patchText: "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n" },
      output: { ok: true, summary: { filesChanged: 1, insertions: 1, deletions: 1, files: [] } }
    }
  ],
  tags: ["patch", "multi-file"],
  filePath: "seed/server/src/kernel/tools/apply_patch.ts"
};

function sha256(text: string) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function stripPrefix(p: string) {
  // Remove git diff prefixes to get relative paths.
  if (p === "/dev/null") {
    return p;
  }
  return p.replace(/^(a\/|b\/)/, "");
}

function parseHunkHeader(line: string) {
  // Parse unified diff hunk header: @@ -a,b +c,d @@
  const m = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!m) {
    return null;
  }
  return {
    oldStart: parseInt(m[1], 10),
    oldLen: m[2] ? parseInt(m[2], 10) : 1,
    newStart: parseInt(m[3], 10),
    newLen: m[4] ? parseInt(m[4], 10) : 1
  };
}

function parseUnifiedDiff(
  patchText: string
): FilePatch[] | { error: PatchErrorCode; details?: unknown } {
  // Parses a unified diff into per-file hunks. No rename/delete support.
  if (patchText.includes("GIT binary patch")) {
    return { error: "BINARY_PATCH_NOT_SUPPORTED" };
  }

  const lines = patchText.split(/\r?\n/);
  const files: FilePatch[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("--- ")) {
      const oldRaw = line.slice(4).trim().split(/\s+/)[0];
      const oldPath = stripPrefix(oldRaw);
      i += 1;
      if (i >= lines.length || !lines[i].startsWith("+++ ")) {
        return { error: "MALFORMED_DIFF", details: { atLine: i, expected: "+++ ..." } };
      }
      const newRaw = lines[i].slice(4).trim().split(/\s+/)[0];
      const newPath = stripPrefix(newRaw);
      const fp: FilePatch = { oldPath, newPath, hunks: [] };
      i += 1;

      while (i < lines.length && !lines[i].startsWith("--- ")) {
        if (lines[i].startsWith("@@ ")) {
          const hdr = parseHunkHeader(lines[i]);
          if (!hdr) {
            return { error: "MALFORMED_HUNK_HEADER", details: { atLine: i, line: lines[i] } };
          }
          const hunk: Hunk = { ...hdr, lines: [] };
          i += 1;
          while (i < lines.length) {
            const l = lines[i];
            if (l.startsWith("@@ ") || l.startsWith("--- ")) {
              break;
            }
            if (l === "\\ No newline at end of file") {
              i += 1;
              continue;
            }
            if (l === "" && i === lines.length - 1) {
              i += 1;
              break;
            }
            const kind = l[0] as " " | "+" | "-";
            if (kind !== " " && kind !== "+" && kind !== "-") {
              return { error: "MALFORMED_HUNK_LINE", details: { atLine: i, line: l } };
            }
            hunk.lines.push({ kind, text: l.slice(1) });
            i += 1;
          }
          fp.hunks.push(hunk);
          continue;
        }
        i += 1;
      }

      files.push(fp);
      continue;
    }

    i += 1;
  }

  return files;
}

type SupportErrorCode = "DELETE_NOT_SUPPORTED" | "RENAME_NOT_SUPPORTED";

function assertSupportedFilePatch(fp: FilePatch):
  | { ok: true }
  | { ok: false; code: SupportErrorCode; message: string } {
  // Only allow create and modify; delete/rename are explicitly disallowed.
  const isCreate = fp.oldPath === "/dev/null" && fp.newPath !== "/dev/null";
  const isDelete = fp.newPath === "/dev/null" && fp.oldPath !== "/dev/null";
  const isModify =
    fp.oldPath !== "/dev/null" && fp.newPath !== "/dev/null" && fp.oldPath === fp.newPath;

  if (isDelete) {
    return { ok: false as const, code: "DELETE_NOT_SUPPORTED", message: "File deletion not supported" };
  }
  if (!isCreate && !isModify) {
    return {
      ok: false as const,
      code: "RENAME_NOT_SUPPORTED",
      message: "Renames/copies not supported"
    };
  }
  return { ok: true as const };
}

function applyFilePatchToText(before: string, fp: FilePatch) {
  // Apply hunks sequentially using exact context matching.
  let lines = before.split("\n");
  let insertions = 0;
  let deletions = 0;
  let offset = 0;

  for (let h = 0; h < fp.hunks.length; h += 1) {
    const hunk = fp.hunks[h];
    let cursor = hunk.oldStart - 1 + offset;
    if (cursor < 0 || cursor > lines.length) {
      return {
        ok: false as const,
        code: "HUNK_OUT_OF_BOUNDS" as PatchErrorCode,
        message: "Hunk starts outside file bounds.",
        details: { hunkIndex: h, cursor, lineCount: lines.length }
      };
    }

    for (let k = 0; k < hunk.lines.length; k += 1) {
      const hl = hunk.lines[k];
      if (hl.kind === " ") {
        if (lines[cursor] !== hl.text) {
          return {
            ok: false as const,
            code: "HUNK_FAILED" as PatchErrorCode,
            message: "Context mismatch; patch does not apply cleanly.",
            details: { hunkIndex: h, lineIndex: cursor + 1, expected: hl.text, actual: lines[cursor] }
          };
        }
        cursor += 1;
      } else if (hl.kind === "-") {
        if (lines[cursor] !== hl.text) {
          return {
            ok: false as const,
            code: "HUNK_FAILED" as PatchErrorCode,
            message: "Removal mismatch; patch does not apply cleanly.",
            details: { hunkIndex: h, lineIndex: cursor + 1, expected: hl.text, actual: lines[cursor] }
          };
        }
        lines.splice(cursor, 1);
        deletions += 1;
        offset -= 1;
      } else {
        lines.splice(cursor, 0, hl.text);
        insertions += 1;
        offset += 1;
        cursor += 1;
      }
    }
  }

  return { ok: true as const, after: lines.join("\n"), insertions, deletions };
}

async function readUtf8IfExists(p: string, maxBytes: number) {
  // Read file if present, enforce size limit, normalize line endings.
  try {
    const buf = await fs.readFile(p);
    if (buf.byteLength > maxBytes) {
      throw new Error("FILE_TOO_LARGE");
    }
    const text = buf.toString("utf8").replace(/\r\n/g, "\n");
    return { exists: true, text, sha: sha256(text) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { exists: false };
    }
    if (String((error as Error).message) === "FILE_TOO_LARGE") {
      throw error;
    }
    throw error;
  }
}

type PlannedWrite = {
  relPath: string;
  absPath: string;
  dirAbs: string;
  tmpAbs: string;
  afterText: string;
  shaBefore?: string;
  shaAfter: string;
  insertions: number;
  deletions: number;
};

export async function applyUnifiedDiff(
  input: ApplyPatchArgs
): Promise<ToolResult<ApplyPatchResult>> {
  // Plan writes first, then atomically swap temp files into place.
  const limits = {
    maxFiles: input.limits?.maxFiles ?? 50,
    maxPatchBytes: input.limits?.maxPatchBytes ?? 2 * 1024 * 1024,
    maxFileBytes: input.limits?.maxFileBytes ?? 2 * 1024 * 1024
  };

  if (Buffer.byteLength(input.patchText, "utf8") > limits.maxPatchBytes) {
    return {
      ok: false,
      error: { code: "PATCH_TOO_LARGE", message: "Patch exceeds max size.", details: limits }
    };
  }

  const parsed = parseUnifiedDiff(input.patchText);
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      error: { code: parsed.error, message: "Failed to parse diff.", details: parsed.details }
    };
  }
  if (parsed.length === 0) {
    return { ok: false, error: { code: "EMPTY_PATCH", message: "No file patches found." } };
  }
  if (parsed.length > limits.maxFiles) {
    return {
      ok: false,
      error: {
        code: "TOO_MANY_FILES",
        message: "Patch touches too many files.",
        details: { files: parsed.length, maxFiles: limits.maxFiles }
      }
    };
  }

  const planned: PlannedWrite[] = [];
  const seen = new Set<string>();

  for (const fp of parsed) {
    const support = assertSupportedFilePatch(fp);
    if (!support.ok) {
      return { ok: false, error: { code: support.code, message: support.message } };
    }

    const isCreate = fp.oldPath === "/dev/null";
    const relPath = fp.newPath;
    const relNorm = relPath.replaceAll("\\", "/");
    if (seen.has(relNorm)) {
      return {
        ok: false,
        error: {
          code: "INVALID_ARGS",
          message: "Patch includes the same file multiple times.",
          details: { path: relNorm }
        }
      };
    }
    seen.add(relNorm);

    const baseName = path.posix.basename(relNorm);
    if (relNorm.startsWith(".git/") || relNorm === ".git") {
      return {
        ok: false,
        error: {
          code: "DENYLIST_PATH",
          message: "Refusing to edit .git directory",
          details: { path: relNorm }
        }
      };
    }
    if (baseName === ".env" || baseName.startsWith(".env.")) {
      return {
        ok: false,
        error: {
          code: "DENYLIST_PATH",
          message: "Refusing to edit env files",
          details: { path: relNorm }
        }
      };
    }

    const resolved = await resolvePathWithinRoot({
      allowedRootAbs: input.allowedRootAbs,
      relativePath: relPath
    });
    if (!resolved.ok) {
      return {
        ok: false,
        error: { code: resolved.code, message: "Path rejected", details: resolved.details }
      };
    }

    let beforeText = "";
    let shaBefore: string | undefined;
    if (!isCreate) {
      try {
        const read = await readUtf8IfExists(resolved.absPath, limits.maxFileBytes);
        if (!read.exists) {
          return {
            ok: false,
            error: {
              code: "FILE_NOT_FOUND",
              message: "Patch expects an existing file but it does not exist.",
              details: { path: relNorm }
            }
          };
        }
        beforeText = read.text as string;
        shaBefore = read.sha as string;
      } catch (error) {
        if (String((error as Error).message) === "FILE_TOO_LARGE") {
          return {
            ok: false,
            error: {
              code: "FILE_TOO_LARGE",
              message: "Existing file exceeds max size.",
              details: { path: relNorm, maxFileBytes: limits.maxFileBytes }
            }
          };
        }
        return {
          ok: false,
          error: {
            code: "READ_FAILED",
            message: "Failed to read file.",
            details: { path: relNorm, error: String(error) }
          }
        };
      }
    } else {
      try {
        const read = await readUtf8IfExists(resolved.absPath, limits.maxFileBytes);
        if (read.exists) {
          return {
            ok: false,
            error: {
              code: "CREATE_BUT_EXISTS",
              message: "Patch tries to create a file that already exists.",
              details: { path: relNorm }
            }
          };
        }
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "READ_FAILED",
            message: "Failed to check file existence.",
            details: { path: relNorm, error: String(error) }
          }
        };
      }
    }

    const applied = applyFilePatchToText(beforeText, fp);
    if (!applied.ok) {
      return {
        ok: false,
        error: {
          code: applied.code,
          message: applied.message,
          details: { path: relNorm, ...applied.details }
        }
      };
    }

    const afterBytes = Buffer.byteLength(applied.after, "utf8");
    if (afterBytes > limits.maxFileBytes) {
      return {
        ok: false,
        error: {
          code: "FILE_TOO_LARGE",
          message: "Patched file exceeds max size.",
          details: { path: relNorm, maxFileBytes: limits.maxFileBytes }
        }
      };
    }

    const dirAbs = path.dirname(resolved.absPath);
    const tmpAbs = path.join(
      dirAbs,
      `.tmp-${path.basename(resolved.absPath)}-${crypto.randomUUID()}`
    );

    planned.push({
      relPath: relNorm,
      absPath: resolved.absPath,
      dirAbs,
      tmpAbs,
      afterText: applied.after,
      shaBefore,
      shaAfter: sha256(applied.after),
      insertions: applied.insertions,
      deletions: applied.deletions
    });
  }

  try {
    // Write all temp files before committing to avoid partial edits.
    for (const w of planned) {
      await fs.mkdir(w.dirAbs, { recursive: true });
      await fs.writeFile(w.tmpAbs, w.afterText, "utf8");
    }
  } catch (error) {
    await Promise.allSettled(planned.map((w) => fs.rm(w.tmpAbs, { force: true })));
    return {
      ok: false,
      error: { code: "TEMP_WRITE_FAILED", message: "Failed writing temp files.", details: { error: String(error) } }
    };
  }

  try {
    // Replace originals with temp files.
    for (const w of planned) {
      await fs.rename(w.tmpAbs, w.absPath);
    }
  } catch (error) {
    await Promise.allSettled(planned.map((w) => fs.rm(w.tmpAbs, { force: true })));
    return {
      ok: false,
      error: { code: "COMMIT_FAILED", message: "Failed committing temp files.", details: { error: String(error) } }
    };
  }

  const files = planned.map((w) => ({
    path: w.relPath,
    insertions: w.insertions,
    deletions: w.deletions,
    sha256Before: w.shaBefore,
    sha256After: w.shaAfter
  }));

  return {
    ok: true,
    summary: {
      filesChanged: files.length,
      insertions: files.reduce((acc, f) => acc + f.insertions, 0),
      deletions: files.reduce((acc, f) => acc + f.deletions, 0),
      files
    }
  };
}
