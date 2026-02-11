import type { ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";
import { readFileTool } from "./read_file.js";

export type ReadFilesArgs = {
  root: string;
  paths: string[];
  maxBytesEach?: number;
  maxTotalBytes?: number;
};

export type ReadFilesResult = {
  files: Array<{
    path: string;
    content?: string;
    truncated?: boolean;
    totalBytes?: number;
    error?: { code: string; message: string };
  }>;
};

export const spec: ToolSpec = {
  name: "read_files",
  description: "Read multiple UTF-8 text files within the root directory.",
  argsSchema: {
    type: "object",
    properties: {
      root: { type: "string", description: "Root directory (absolute or relative to workspace)." },
      paths: { type: "array", items: { type: "string" }, description: "File paths relative to root." },
      maxBytesEach: { type: "number", description: "Maximum bytes per file." },
      maxTotalBytes: { type: "number", description: "Maximum total bytes across files." }
    },
    required: ["root", "paths"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
            truncated: { type: "boolean" },
            totalBytes: { type: "number" },
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" }
              },
              additionalProperties: false
            }
          },
          required: ["path"],
          additionalProperties: false
        }
      }
    },
    required: ["files"],
    additionalProperties: false
  },
  examples: [
    {
      input: { root: "projects/demo", paths: ["src/index.ts"] },
      output: { ok: true, result: { files: [] } }
    }
  ],
  tags: ["fs", "read", "batch"],
  filePath: "seed/server/src/kernel/tools/read_files.ts"
};

export async function readFiles(args: ReadFilesArgs): Promise<ToolResult<ReadFilesResult>> {
  try {
    const maxEach = args.maxBytesEach ?? 80_000;
    const maxTotal = args.maxTotalBytes ?? 400_000;
    let total = 0;
    const out: ReadFilesResult["files"] = [];

    for (const p of args.paths) {
      if (total >= maxTotal) {
        out.push({ path: p, error: { code: "TOO_LARGE", message: "Batch byte limit reached" } });
        continue;
      }
      const result = await readFileTool({
        root: args.root,
        path: p,
        maxBytes: Math.min(maxEach, maxTotal - total)
      });
      if (!result.ok) {
        out.push({ path: p, error: { code: result.error.code, message: result.error.message } });
      } else {
        total += Buffer.byteLength(result.result.content, "utf-8");
        out.push({
          path: p,
          content: result.result.content,
          truncated: result.result.truncated,
          totalBytes: result.result.totalBytes
        });
      }
    }

    return { ok: true, result: { files: out } };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "IO_ERROR",
        message: error instanceof Error ? error.message : "read_files failed",
        details: error
      }
    };
  }
}
