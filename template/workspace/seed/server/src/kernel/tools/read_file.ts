import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ensureParentDirInsideRoot, resolveWithinRoot } from "./path_safety.js";
import type { ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";

// Tool to read a single UTF-8 file with safety checks and hashing.
export type ReadFileArgs = {
  root: string;
  path: string;
  maxBytes?: number;
  range?: { startLine?: number; endLine?: number };
};

export type ReadFileResult = {
  path: string;
  encoding: "utf-8";
  content: string;
  truncated: boolean;
  totalBytes: number;
  sha256: string;
};

export const spec: ToolSpec = {
  name: "read_file",
  description: "Read a UTF-8 text file within the root directory, optionally by line range.",
  argsSchema: {
    type: "object",
    properties: {
      root: { type: "string", description: "Root directory (absolute or relative to workspace)." },
      path: { type: "string", description: "File path relative to root." },
      maxBytes: { type: "number", description: "Maximum bytes to read." },
      range: {
        type: "object",
        properties: {
          startLine: { type: "number" },
          endLine: { type: "number" }
        },
        additionalProperties: false
      }
    },
    required: ["root", "path"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      path: { type: "string" },
      encoding: { type: "string" },
      content: { type: "string" },
      truncated: { type: "boolean" },
      totalBytes: { type: "number" },
      sha256: { type: "string" },
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
      input: { root: "projects/demo", path: "src/index.ts" },
      output: { ok: true, path: "src/index.ts", encoding: "utf-8", content: "", truncated: false, totalBytes: 0, sha256: "" }
    }
  ],
  tags: ["fs", "read"],
  filePath: "seed/server/src/kernel/tools/read_file.ts"
};

export async function readFileTool(args: ReadFileArgs): Promise<ToolResult<ReadFileResult>> {
  try {
    const rootAbs = path.resolve(args.root);
    const fileAbs = resolveWithinRoot(rootAbs, args.path);

    // Ensure the target stays within the root (no traversal or symlink escape).
    await ensureParentDirInsideRoot(rootAbs, fileAbs);

    const buf = await fs.readFile(fileAbs);
    const totalBytes = buf.byteLength;
    const maxBytes = args.maxBytes ?? 200_000;
    const sliced = buf.slice(0, maxBytes);
    const truncated = totalBytes > maxBytes;

    // Reject binary files by detecting NUL bytes in the read slice.
    const nulIndex = sliced.indexOf(0);
    if (nulIndex !== -1) {
      return {
        ok: false,
        error: { code: "NOT_ALLOWED", message: "Binary file read not supported" }
      };
    }

    const fullText = buf.toString("utf-8");
    let content = sliced.toString("utf-8");

    if (args.range?.startLine || args.range?.endLine) {
      // Line ranges apply to the truncated content to keep bounds safe.
      const lines = content.split(/\r?\n/);
      const start = Math.max(1, args.range.startLine ?? 1);
      const end = Math.min(lines.length, args.range.endLine ?? lines.length);
      content = lines.slice(start - 1, end).join("\n");
    }

    // Hash the full normalized content for edit verification.
    const sha256 = crypto.createHash("sha256").update(fullText.replace(/\r\n/g, "\n"), "utf8").digest("hex");

    return {
      ok: true,
      path: args.path,
      encoding: "utf-8",
      content,
      truncated,
      totalBytes,
      sha256
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const code = err.code === "ENOENT" ? "NOT_FOUND" : "IO_ERROR";
    return {
      ok: false,
      error: {
        code,
        message: err?.message ?? "read_file failed",
        details: error
      }
    };
  }
}
