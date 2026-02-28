import path from "node:path";
import fs from "node:fs/promises";
import fg, { type Entry } from "fast-glob";
import { DEFAULT_LIST_DENY_GLOBS } from "./path_safety.js";
import type { ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";

// Tool to enumerate files safely with deny-list defaults.
export type ListFilesArgs = {
  root: string;
  globs?: string[];
  maxDepth?: number;
  maxResults?: number;
  includeDirs?: boolean;
};

export type ListFilesResult = {
  root: string;
  entries: Array<{
    path: string;
    type: "file" | "dir";
  }>;
  truncated: boolean;
};

export const spec: ToolSpec = {
  name: "list_files",
  description:
    "Enumerate files in a root directory, optionally filtered by globs and bounded by depth and count.",
  argsSchema: {
    type: "object",
    properties: {
      root: { type: "string", description: "Root directory (absolute or relative to workspace)." },
      globs: {
        type: "array",
        items: { type: "string" },
        description: "Optional glob patterns, e.g. ['**/*.ts', '!**/node_modules/**']."
      },
      maxDepth: { type: "number", description: "Maximum directory depth." },
      maxResults: { type: "number", description: "Maximum number of entries to return." },
      includeDirs: { type: "boolean", description: "Include directories in results." }
    },
    required: ["root"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      root: { type: "string" },
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            type: { type: "string", enum: ["file", "dir"] }
          },
          required: ["path", "type"],
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
      input: { root: "projects/demo", globs: ["**/*.ts"], maxDepth: 6 },
      output: { ok: true, root: "/abs/projects/demo", entries: [], truncated: false }
    }
  ],
  tags: ["fs", "list"],
  filePath: "seed/server/src/kernel/tools/list_files.ts"
};

function isExplicitlyAllowed(globs: string[] | undefined, token: string): boolean {
  // Detect explicit inclusion of otherwise-denied folders.
  if (!globs) {
    return false;
  }
  return globs.some((glob) => glob.includes(token));
}

export async function listFiles(args: ListFilesArgs): Promise<ToolResult<ListFilesResult>> {
  try {
    const maxDepth = args.maxDepth ?? 8;
    const maxResults = args.maxResults ?? 2000;
    const includeDirs = args.includeDirs ?? false;

    const rootAbs = path.resolve(args.root);
    const st = await fs.stat(rootAbs).catch(() => null);
    if (!st || !st.isDirectory()) {
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: `Root not found or not a directory: ${args.root}` }
      };
    }

    const baseGlobs = args.globs?.length ? args.globs : ["**/*"];
    let deny = [...DEFAULT_LIST_DENY_GLOBS];

    // Allow explicit opt-in for commonly denied paths.
    if (isExplicitlyAllowed(args.globs, ".git")) {
      deny = deny.filter((pattern) => !pattern.includes(".git"));
    }
    if (isExplicitlyAllowed(args.globs, "node_modules")) {
      deny = deny.filter((pattern) => !pattern.includes("node_modules"));
    }
    if (isExplicitlyAllowed(args.globs, "seed")) {
      deny = deny.filter((pattern) => !pattern.includes("seed"));
    }
    if (isExplicitlyAllowed(args.globs, "state")) {
      deny = deny.filter((pattern) => !pattern.includes("state"));
    }

    const patterns = [...baseGlobs, ...deny];
    const entries = (await fg(patterns, {
      cwd: rootAbs,
      onlyFiles: !includeDirs,
      onlyDirectories: false,
      dot: true,
      followSymbolicLinks: false,
      unique: true,
      suppressErrors: true,
      stats: includeDirs
    })) as unknown as Array<string | Entry>;

    const depthLimit = typeof maxDepth === "number" ? maxDepth : undefined;
    const filtered = depthLimit === undefined
      ? entries
      : entries.filter((entry) => {
          const rel = typeof entry === "string" ? entry : entry.path;
          const normalized = rel.replace(/^\.\//, "");
          const depth = normalized.split("/").length - 1;
          return depth <= depthLimit;
        });

    const truncated = filtered.length > maxResults;
    const sliced = filtered.slice(0, maxResults);

    const mapped: ListFilesResult["entries"] = sliced.map((entry) => {
      if (typeof entry === "string") {
        const normalized = entry.replace(/^\.\//, "");
        return { path: normalized, type: "file" as const };
      }
      const entryPath = entry.path.replace(/^\.\//, "");
      const type: "file" | "dir" = entry.stats?.isDirectory() ? "dir" : "file";
      return { path: entryPath, type };
    });

    return {
      ok: true,
      root: rootAbs,
      entries: mapped,
      truncated
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "IO_ERROR",
        message: error instanceof Error ? error.message : "list_files failed",
        details: error
      }
    };
  }
}
