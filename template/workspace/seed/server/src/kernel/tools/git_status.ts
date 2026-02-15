import fs from "node:fs/promises";
import path from "node:path";
import { runGit } from "./git_utils.js";
import type { ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";

export type GitStatusArgs = { root: string };

export type GitStatusResult = {
  branch?: string;
  isClean: boolean;
  changes: Array<{ path: string; status: string }>;
};

export const spec: ToolSpec = {
  name: "git_status",
  description: "Return git status (porcelain) for a repository root.",
  argsSchema: {
    type: "object",
    properties: {
      root: { type: "string", description: "Git repository root (absolute or relative to workspace)." }
    },
    required: ["root"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      branch: { type: "string" },
      isClean: { type: "boolean" },
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            status: { type: "string" }
          },
          required: ["path", "status"],
          additionalProperties: false
        }
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
      input: { root: "projects/demo" },
      output: { ok: true, isClean: true, changes: [] }
    }
  ],
  tags: ["git", "status"],
  filePath: "seed/server/src/kernel/tools/git_status.ts"
};

export async function gitStatus(args: GitStatusArgs): Promise<ToolResult<GitStatusResult>> {
  try {
    const rootAbs = path.resolve(args.root);
    const st = await fs.stat(rootAbs).catch(() => null);
    if (!st || !st.isDirectory()) {
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: `Root not found or not a directory: ${args.root}` }
      };
    }

    const branchResult = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], rootAbs);
    const branch = branchResult.code === 0 ? branchResult.stdout.trim() : undefined;

    const statusResult = await runGit(["status", "--porcelain=v1"], rootAbs);
    if (statusResult.code !== 0) {
      return {
        ok: false,
        error: {
          code: "GIT_ERROR",
          message: statusResult.stderr || "git status failed",
          details: statusResult.stderr
        }
      };
    }

    const changes = statusResult.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const status = line.slice(0, 2).trim();
        const file = line.slice(3).trim();
        return { path: file, status };
      });

    return {
      ok: true,
      branch,
      isClean: changes.length === 0,
      changes
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "GIT_ERROR",
        message: error instanceof Error ? error.message : "git_status failed",
        details: error
      }
    };
  }
}
