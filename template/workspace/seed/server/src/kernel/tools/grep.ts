import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";

export type GrepArgs = {
  root: string;
  query: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  globs?: string[];
  maxResults?: number;
  maxFiles?: number;
};

export type GrepResult = {
  matches: Array<{
    path: string;
    line: number;
    column: number;
    snippet: string;
  }>;
  truncated: boolean;
};

export const spec: ToolSpec = {
  name: "grep",
  description: "Search text across files under root using ripgrep (rg).",
  argsSchema: {
    type: "object",
    properties: {
      root: { type: "string", description: "Root directory (absolute or relative to workspace)." },
      query: { type: "string", description: "Literal query or regex." },
      isRegex: { type: "boolean", description: "Treat query as regex." },
      caseSensitive: { type: "boolean", description: "Case-sensitive search." },
      globs: { type: "array", items: { type: "string" }, description: "Optional file globs." },
      maxResults: { type: "number", description: "Maximum matches to return." },
      maxFiles: { type: "number", description: "Maximum files to scan." }
    },
    required: ["root", "query"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      matches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            line: { type: "number" },
            column: { type: "number" },
            snippet: { type: "string" }
          },
          required: ["path", "line", "column", "snippet"],
          additionalProperties: false
        }
      },
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
      input: { root: "projects/demo", query: "TODO" },
      output: { ok: true, matches: [], truncated: false }
    }
  ],
  tags: ["search", "rg"],
  filePath: "seed/server/src/kernel/tools/grep.ts"
};

async function hasRipgrep(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("rg", ["--version"]);
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

export async function grep(args: GrepArgs): Promise<ToolResult<GrepResult>> {
  try {
    if (!(await hasRipgrep())) {
      return {
        ok: false,
        error: {
          code: "NOT_ALLOWED",
          message: "ripgrep (rg) is required. Install from https://github.com/BurntSushi/ripgrep"
        }
      };
    }

    const rootAbs = path.resolve(args.root);
    const st = await fs.stat(rootAbs).catch(() => null);
    if (!st || !st.isDirectory()) {
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: `Root not found or not a directory: ${args.root}` }
      };
    }
    const maxResults = args.maxResults ?? 200;

    const rgArgs: string[] = ["--json"];
    if (!args.caseSensitive) {
      rgArgs.push("-i");
    }
    if (!args.isRegex) {
      rgArgs.push("-F");
    }
    if (args.globs && args.globs.length > 0) {
      for (const glob of args.globs) {
        rgArgs.push("-g", glob);
      }
    }
    rgArgs.push("--max-count", String(maxResults));
    rgArgs.push(args.query, ".");

    const proc = spawn("rg", rgArgs, { cwd: rootAbs });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString("utf-8");
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString("utf-8");
    });

    const exitCode: number = await new Promise((resolve) => proc.on("close", resolve));
    if (exitCode !== 0 && exitCode !== 1) {
      return { ok: false, error: { code: "IO_ERROR", message: stderr || "rg failed" } };
    }

    const matches: GrepResult["matches"] = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      let obj: { type: string; data?: any } | null = null;
      try {
        obj = JSON.parse(line) as { type: string; data?: any };
      } catch {
        continue;
      }
      if (obj.type === "match") {
        const data = obj.data;
        const normalizedPath = String(data.path.text).replace(/^\.\//, "");
        matches.push({
          path: normalizedPath,
          line: data.line_number,
          column: data.submatches?.[0]?.start ?? 0,
          snippet: data.lines.text.trimEnd()
        });
        if (matches.length >= maxResults) {
          break;
        }
      }
    }

    return {
      ok: true,
      matches,
      truncated: matches.length >= maxResults
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "IO_ERROR",
        message: error instanceof Error ? error.message : "grep failed",
        details: error
      }
    };
  }
}
