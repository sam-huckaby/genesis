import fs from "node:fs/promises";
import path from "node:path";
import { runGit } from "./git_utils.js";
import type { ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";

export type GitDiffArgs = {
  root: string;
  ref?: string;
  staged?: boolean;
  maxBytes?: number;
};

export type GitDiffResult = {
  diff: string;
  truncated: boolean;
};

export const spec: ToolSpec = {
  name: "git_diff",
  description: "Return a git diff for a repository root.",
  argsSchema: {
    type: "object",
    properties: {
      root: { type: "string", description: "Git repository root (absolute or relative to workspace)." },
      ref: { type: "string", description: "Optional git ref for diff." },
      staged: { type: "boolean", description: "Show staged diff." },
      maxBytes: { type: "number", description: "Maximum bytes to return." }
    },
    required: ["root"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      diff: { type: "string" },
      truncated: { type: "boolean" },
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
      input: { root: "projects/demo", staged: false },
      output: { ok: true, diff: "", truncated: false }
    }
  ],
  tags: ["git", "diff"],
  filePath: "seed/server/src/kernel/tools/git_diff.ts"
};

export async function gitDiff(args: GitDiffArgs): Promise<ToolResult<GitDiffResult>> {
  try {
    const rootAbs = path.resolve(args.root);
    const st = await fs.stat(rootAbs).catch(() => null);
    if (!st || !st.isDirectory()) {
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: `Root not found or not a directory: ${args.root}` }
      };
    }
    const maxBytes = args.maxBytes ?? 400_000;

    const diffArgs = ["diff"];
    if (args.staged) {
      diffArgs.push("--cached");
    }
    if (args.ref) {
      diffArgs.push(args.ref);
    }

    const result = await runGit(diffArgs, rootAbs);
    if (result.code !== 0) {
      return { ok: false, error: { code: "GIT_ERROR", message: result.stderr || "git diff failed" } };
    }

    const buf = Buffer.from(result.stdout, "utf-8");
    const truncated = buf.byteLength > maxBytes;
    const diff = truncated ? buf.slice(0, maxBytes).toString("utf-8") : result.stdout;

    return { ok: true, diff, truncated };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "GIT_ERROR",
        message: error instanceof Error ? error.message : "git_diff failed",
        details: error
      }
    };
  }
}
