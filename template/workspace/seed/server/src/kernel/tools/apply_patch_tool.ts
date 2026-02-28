import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { resolvePathWithinRoot } from "./safe_path.js";
import type { ToolErrorCode, ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";

// Apply headerless V4A-style patches with per-operation validation.
export type ApplyPatchOperation = {
  type: "create_file" | "update_file" | "delete_file";
  path: string;
  diff?: string;
};

export type ApplyPatchArgs = {
  allowedRootAbs: string;
  operations: ApplyPatchOperation[];
  limits?: {
    maxPatchBytes?: number;
    maxFileBytes?: number;
  };
};

export type ApplyPatchResult = {
  summary: {
    operationsApplied: number;
    filesChanged: number;
    files: Array<{ path: string; type: "create_file" | "update_file" | "delete_file" }>;
  };
};

export const spec: ToolSpec = {
  name: "apply_patch",
  description:
    "Apply file operations using V4A diffs. Prefer edit_file for small/surgical edits.\n\n" +
    "Rules:\n" +
    "- operations is an array of {type,path,...}.\n" +
    "- type is one of create_file, update_file, delete_file.\n" +
    "- path is relative to the project root.\n" +
    "- create_file/update_file MUST include diff.\n" +
    "- delete_file MUST NOT include diff.\n" +
    "- diff is a V4A patch (headerless): hunks start with '@@' and all lines start with '+', '-', or ' '.\n" +
    "- update_file hunks MUST include at least one context line (a line prefixed with ' ') along with '-' or '+' prefixed lines.\n" +
    "- create_file hunks MUST only include '+' lines.\n" +
    "- Do NOT wrap the diff in markdown fences.",
  argsSchema: {
    type: "object",
    properties: {
      operations: {
        type: "array",
        minItems: 1,
        items: {
          oneOf: [
            {
              type: "object",
              properties: {
                type: { type: "string", const: "create_file" },
                path: { type: "string" },
                diff: { type: "string" }
              },
              required: ["type", "path", "diff"],
              additionalProperties: false
            },
            {
              type: "object",
              properties: {
                type: { type: "string", const: "update_file" },
                path: { type: "string" },
                diff: { type: "string" }
              },
              required: ["type", "path", "diff"],
              additionalProperties: false
            },
            {
              type: "object",
              properties: {
                type: { type: "string", const: "delete_file" },
                path: { type: "string" }
              },
              required: ["type", "path"],
              additionalProperties: false
            }
          ]
        }
      },
      limits: {
        type: "object",
        properties: {
          maxPatchBytes: { type: "number" },
          maxFileBytes: { type: "number" }
        },
        additionalProperties: false
      }
    },
    required: ["operations"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      summary: {
        type: "object",
        properties: {
          operationsApplied: { type: "number" },
          filesChanged: { type: "number" },
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                type: { type: "string", enum: ["create_file", "update_file", "delete_file"] }
              },
              required: ["path", "type"],
              additionalProperties: false
            }
          }
        },
        required: ["operationsApplied", "filesChanged", "files"],
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
      input: {
        operations: [
          {
            type: "update_file",
            path: "lib/fib.py",
            diff: "@@\n def fib(n):\n-    return n\n+    return fib(n - 1) + fib(n - 2)\n"
          },
          {
            type: "create_file",
            path: "lib/notes.txt",
            diff: "@@\n+new note\n+another line\n"
          }
        ]
      },
      output: {
        ok: true,
        summary: {
          operationsApplied: 2,
          filesChanged: 2,
          files: [
            { path: "lib/fib.py", type: "update_file" },
            { path: "lib/notes.txt", type: "create_file" }
          ]
        }
      }
    }
  ],
  tags: ["patch", "v4a"],
  filePath: "seed/server/src/kernel/tools/apply_patch_tool.ts"
};

type HunkLine = { kind: " " | "+" | "-"; text: string };
type Hunk = { lines: HunkLine[] };

type ParseResult =
  | { ok: true; hunks: Hunk[] }
  | { ok: false; error: { code: ToolErrorCode; message: string; hint?: string; details?: unknown } };

type ApplyResult =
  | { ok: true; output: string }
  | { ok: false; error: { code: ToolErrorCode; message: string; hint?: string; details?: unknown } };

type PlannedWrite = {
  type: "create_file" | "update_file";
  relPath: string;
  absPath: string;
  dirAbs: string;
  tmpAbs: string;
  content: string;
};

type PlannedDelete = {
  type: "delete_file";
  relPath: string;
  absPath: string;
};

const ENDLINE_RE = /\r?\n/;

function normalizeDiffLines(diff: string): string[] {
  // Normalize line endings and strip trailing empty line.
  return diff
    .split(ENDLINE_RE)
    .map((line) => line.replace(/\r$/, ""))
    .filter((line, idx, arr) => !(idx === arr.length - 1 && line === ""));
}

function parseHeaderlessDiff(diff: string): ParseResult {
  // V4A patches use "@@" lines without line numbers.
  const lines = normalizeDiffLines(diff);
  if (lines.length === 0) {
    return { ok: false, error: { code: "EMPTY_PATCH", message: "Diff is empty." } };
  }

  const hunks: Hunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const header = lines[i];
    if (!header.startsWith("@@")) {
      return {
        ok: false,
        error: {
          code: "MALFORMED_DIFF",
          message: "Expected hunk header '@@'.",
          details: { line: i + 1, value: header }
        }
      };
    }
    if (header.trim() !== "@@") {
      return {
        ok: false,
        error: {
          code: "MALFORMED_HUNK_HEADER",
          message: "Malformed hunk header. Use '@@' only.",
          details: { line: i + 1, value: header }
        }
      };
    }
    i += 1;

    const hunkLines: HunkLine[] = [];
    while (i < lines.length && !lines[i].startsWith("@@")) {
      const raw = lines[i];
      if (raw.length === 0) {
        return {
          ok: false,
          error: {
            code: "MALFORMED_HUNK_LINE",
            message: "Hunk lines must start with ' ', '+', or '-'.",
            details: { line: i + 1, value: raw }
          }
        };
      }
      const kind = raw[0] as " " | "+" | "-";
      if (kind !== " " && kind !== "+" && kind !== "-") {
        return {
          ok: false,
          error: {
            code: "MALFORMED_HUNK_LINE",
            message: "Hunk lines must start with ' ', '+', or '-'.",
            details: { line: i + 1, value: raw }
          }
        };
      }
      hunkLines.push({ kind, text: raw.slice(1) });
      i += 1;
    }

    if (hunkLines.length === 0) {
      return {
        ok: false,
        error: {
          code: "MALFORMED_DIFF",
          message: "Hunk contains no lines.",
          details: { line: i + 1 }
        }
      };
    }
    hunks.push({ lines: hunkLines });
  }

  return { ok: true, hunks };
}

function matchesAt(lines: string[], hunk: Hunk, start: number): boolean {
  // Check whether all non-addition lines match at the given offset.
  let pos = start;
  for (const line of hunk.lines) {
    if (line.kind === "+") {
      continue;
    }
    if (pos >= lines.length) {
      return false;
    }
    if (lines[pos] !== line.text) {
      return false;
    }
    pos += 1;
  }
  return true;
}

function findHunkMatches(lines: string[], hunk: Hunk): number[] {
  // Find all candidate offsets where the hunk context matches.
  const matches: number[] = [];
  for (let i = 0; i <= lines.length; i += 1) {
    if (matchesAt(lines, hunk, i)) {
      matches.push(i);
    }
  }
  return matches;
}

function applyHunk(lines: string[], hunk: Hunk, start: number): string[] {
  // Apply a single hunk at a specific offset.
  const out: string[] = [];
  out.push(...lines.slice(0, start));
  let pos = start;
  for (const line of hunk.lines) {
    if (line.kind === " ") {
      out.push(lines[pos]);
      pos += 1;
    } else if (line.kind === "-") {
      pos += 1;
    } else {
      out.push(line.text);
    }
  }
  out.push(...lines.slice(pos));
  return out;
}

function applyUpdateDiff(input: string, hunks: Hunk[]): ApplyResult {
  // Updates require at least one context line to avoid ambiguous matches.
  let lines = input.split("\n");
  for (const hunk of hunks) {
    const hasContext = hunk.lines.some((line) => line.kind === " ");
    if (!hasContext) {
      return {
        ok: false,
        error: {
          code: "ANCHOR_REQUIRED",
          message: "Each update hunk must include at least one context line (prefix ' ').",
          hint: "Add a context line to disambiguate the hunk location."
        }
      };
    }

    const matches = findHunkMatches(lines, hunk);
    if (matches.length === 0) {
      return {
        ok: false,
        error: {
          code: "HUNK_FAILED",
          message: "Hunk context did not match the target file."
        }
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        error: {
          code: "AMBIGUOUS_MATCH",
          message: "Hunk context matched multiple locations.",
          hint: "Add more context lines to make the hunk unique."
        }
      };
    }

    lines = applyHunk(lines, hunk, matches[0]);
  }

  return { ok: true, output: lines.join("\n") };
}

function buildCreateContent(hunks: Hunk[]): ApplyResult {
  // create_file diffs may only add lines.
  const out: string[] = [];
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind !== "+") {
        return {
          ok: false,
          error: {
            code: "MALFORMED_DIFF",
            message: "create_file hunks may only include additions.",
            hint: "Use only '+' lines in create_file diffs."
          }
        };
      }
      out.push(line.text);
    }
  }
  if (out.length === 0) {
    return { ok: false, error: { code: "EMPTY_PATCH", message: "Diff is empty." } };
  }
  return { ok: true, output: out.join("\n") };
}

function normalizePath(relPath: string): string {
  return relPath.replaceAll("\\", "/");
}

function isDeniedPath(relPath: string): { ok: true } | { ok: false; message: string } {
  // Block sensitive paths such as .git and env files.
  const baseName = path.posix.basename(relPath);
  if (relPath.startsWith(".git/") || relPath === ".git") {
    return { ok: false, message: "Refusing to edit .git directory" };
  }
  if (baseName === ".env" || baseName.startsWith(".env.")) {
    return { ok: false, message: "Refusing to edit env files" };
  }
  return { ok: true };
}

export async function applyPatchTool(
  input: ApplyPatchArgs
): Promise<ToolResult<ApplyPatchResult>> {
  // Plan all operations first, then write temp files and commit atomically.
  const limits = {
    maxPatchBytes: input.limits?.maxPatchBytes ?? 2 * 1024 * 1024,
    maxFileBytes: input.limits?.maxFileBytes ?? 2 * 1024 * 1024
  };

  if (!Array.isArray(input.operations) || input.operations.length === 0) {
    return { ok: false, error: { code: "INVALID_ARGS", message: "Missing operations" } };
  }

  const plannedWrites: PlannedWrite[] = [];
  const plannedDeletes: PlannedDelete[] = [];
  const seen = new Set<string>();

  for (const operation of input.operations) {
    if (!operation || typeof operation !== "object") {
      return { ok: false, error: { code: "INVALID_ARGS", message: "Missing operation" } };
    }
    if (!operation.path || typeof operation.path !== "string") {
      return { ok: false, error: { code: "INVALID_ARGS", message: "Missing path" } };
    }
    if (!operation.type) {
      return { ok: false, error: { code: "INVALID_ARGS", message: "Missing operation type" } };
    }

    const rel = normalizePath(operation.path);
    if (seen.has(rel)) {
      return {
        ok: false,
        error: {
          code: "INVALID_ARGS",
          message: "Duplicate path in operations array.",
          details: { path: rel }
        }
      };
    }
    seen.add(rel);

    const denied = isDeniedPath(rel);
    if (!denied.ok) {
      return {
        ok: false,
        error: { code: "DENYLIST_PATH", message: denied.message, details: { path: rel } }
      };
    }

    const resolved = await resolvePathWithinRoot({
      allowedRootAbs: input.allowedRootAbs,
      relativePath: rel
    });
    if (!resolved.ok) {
      return { ok: false, error: { code: resolved.code, message: "Path rejected", details: resolved.details } };
    }

    if (operation.type === "delete_file") {
      // Deletions are staged and performed after writes succeed.
      if (operation.diff) {
        return { ok: false, error: { code: "INVALID_ARGS", message: "delete_file must not include diff" } };
      }
      try {
        await fs.stat(resolved.absPath);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        const code = err.code === "ENOENT" ? "NOT_FOUND" : "IO_ERROR";
        return {
          ok: false,
          error: { code, message: "Failed to stat file", details: { path: rel, error: String(error) } }
        };
      }
      plannedDeletes.push({ type: "delete_file", relPath: rel, absPath: resolved.absPath });
      continue;
    }

    const diff = typeof operation.diff === "string" ? operation.diff : "";
    if (!diff) {
      return { ok: false, error: { code: "INVALID_ARGS", message: "Missing diff" } };
    }
    if (Buffer.byteLength(diff, "utf8") > limits.maxPatchBytes) {
      return {
        ok: false,
        error: { code: "PATCH_TOO_LARGE", message: "Diff exceeds max size", details: limits }
      };
    }

    const parsed = parseHeaderlessDiff(diff);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }

    if (operation.type === "create_file") {
      try {
        await fs.stat(resolved.absPath);
        return {
          ok: false,
          error: { code: "CREATE_BUT_EXISTS", message: "File already exists", details: { path: rel } }
        };
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code && err.code !== "ENOENT") {
          return {
            ok: false,
            error: { code: "IO_ERROR", message: "Failed to check file existence", details: { path: rel } }
          };
        }
      }

      const created = buildCreateContent(parsed.hunks);
      if (!created.ok) {
        return { ok: false, error: created.error };
      }
      if (Buffer.byteLength(created.output, "utf8") > limits.maxFileBytes) {
        return {
          ok: false,
          error: { code: "FILE_TOO_LARGE", message: "File exceeds max size", details: limits }
        };
      }

      const dirAbs = path.dirname(resolved.absPath);
      const tmpAbs = path.join(dirAbs, `.tmp-${path.basename(resolved.absPath)}-${crypto.randomUUID()}`);
      plannedWrites.push({
        type: "create_file",
        relPath: rel,
        absPath: resolved.absPath,
        dirAbs,
        tmpAbs,
        content: created.output
      });
      continue;
    }

    if (operation.type !== "update_file") {
      return { ok: false, error: { code: "INVALID_ARGS", message: "Invalid operation type" } };
    }

    let current: string;
    try {
      const buf = await fs.readFile(resolved.absPath);
      if (buf.byteLength > limits.maxFileBytes) {
        return {
          ok: false,
          error: { code: "FILE_TOO_LARGE", message: "File exceeds max size", details: limits }
        };
      }
      current = buf.toString("utf8").replace(/\r\n/g, "\n");
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      const code = err.code === "ENOENT" ? "NOT_FOUND" : "IO_ERROR";
      return {
        ok: false,
        error: { code, message: "Failed to read file", details: { path: rel, error: String(error) } }
      };
    }

    const updated = applyUpdateDiff(current, parsed.hunks);
    if (!updated.ok) {
      return { ok: false, error: updated.error };
    }
    if (Buffer.byteLength(updated.output, "utf8") > limits.maxFileBytes) {
      return {
        ok: false,
        error: { code: "FILE_TOO_LARGE", message: "File exceeds max size", details: limits }
      };
    }

    const dirAbs = path.dirname(resolved.absPath);
    const tmpAbs = path.join(dirAbs, `.tmp-${path.basename(resolved.absPath)}-${crypto.randomUUID()}`);
    plannedWrites.push({
      type: "update_file",
      relPath: rel,
      absPath: resolved.absPath,
      dirAbs,
      tmpAbs,
      content: updated.output
    });
  }

  try {
    // Write temp files first to avoid partial updates.
    for (const w of plannedWrites) {
      await fs.mkdir(w.dirAbs, { recursive: true });
      await fs.writeFile(w.tmpAbs, w.content, "utf8");
    }
  } catch (error) {
    await Promise.allSettled(plannedWrites.map((w) => fs.rm(w.tmpAbs, { force: true })));
    return {
      ok: false,
      error: { code: "WRITE_FAILED", message: "Failed writing temp files", details: { error: String(error) } }
    };
  }

  try {
    // Commit temp files to their final destinations.
    for (const w of plannedWrites) {
      await fs.rename(w.tmpAbs, w.absPath);
    }
  } catch (error) {
    await Promise.allSettled(plannedWrites.map((w) => fs.rm(w.tmpAbs, { force: true })));
    return {
      ok: false,
      error: { code: "WRITE_FAILED", message: "Failed committing temp files", details: { error: String(error) } }
    };
  }

  for (const d of plannedDeletes) {
    // Apply deletions last to keep changesets consistent.
    try {
      await fs.rm(d.absPath);
    } catch (error) {
      return {
        ok: false,
        error: { code: "IO_ERROR", message: "Failed to delete file", details: { path: d.relPath, error: String(error) } }
      };
    }
  }

  const files = input.operations.map((op) => ({
    path: normalizePath(op.path),
    type: op.type
  }));

  return {
    ok: true,
    summary: {
      operationsApplied: input.operations.length,
      filesChanged: files.length,
      files
    }
  };
}
