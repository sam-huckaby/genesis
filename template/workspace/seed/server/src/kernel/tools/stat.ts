import fs from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "./path_safety.js";
import type { ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";

export type StatArgs = {
  root: string;
  path: string;
};

export type StatResult = {
  path: string;
  type: "file" | "dir" | "symlink" | "other";
  size: number;
  mtimeMs: number;
};

export const spec: ToolSpec = {
  name: "stat",
  description: "Return file metadata (type, size, mtime) for a path within root.",
  argsSchema: {
    type: "object",
    properties: {
      root: { type: "string", description: "Root directory (absolute or relative to workspace)." },
      path: { type: "string", description: "Path relative to root." }
    },
    required: ["root", "path"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      type: { type: "string", enum: ["file", "dir", "symlink", "other"] },
      size: { type: "number" },
      mtimeMs: { type: "number" }
    },
    required: ["path", "type", "size", "mtimeMs"],
    additionalProperties: false
  },
  examples: [{ input: { root: "projects/demo", path: "package.json" }, output: { ok: true, result: { path: "package.json", type: "file", size: 0, mtimeMs: 0 } } }],
  tags: ["fs", "stat"],
  filePath: "seed/server/src/kernel/tools/stat.ts"
};

export async function statPath(args: StatArgs): Promise<ToolResult<StatResult>> {
  try {
    const rootAbs = path.resolve(args.root);
    const abs = resolveWithinRoot(rootAbs, args.path);
    const lst = await fs.lstat(abs);

    const type = lst.isFile()
      ? "file"
      : lst.isDirectory()
        ? "dir"
        : lst.isSymbolicLink()
          ? "symlink"
          : "other";

    return {
      ok: true,
      result: { path: args.path, type, size: lst.size, mtimeMs: lst.mtimeMs }
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const code = err.code === "ENOENT" ? "NOT_FOUND" : "IO_ERROR";
    return {
      ok: false,
      error: {
        code,
        message: err?.message ?? "stat failed",
        details: error
      }
    };
  }
}
