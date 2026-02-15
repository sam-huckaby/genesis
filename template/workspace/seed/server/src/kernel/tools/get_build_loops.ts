import type { ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";

export type GetBuildLoopsArgs = {
  projectName: string;
  limit?: number;
};

export type BuildLoopSummary = {
  id: number;
  status: string;
  maxIterations: number;
  stopReason?: string | null;
  model?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GetBuildLoopsResult = {
  loops: BuildLoopSummary[];
};

export const spec: ToolSpec = {
  name: "get_build_loops",
  description: "List build loops for a project.",
  argsSchema: {
    type: "object",
    properties: {
      projectName: { type: "string", description: "Project name." },
      limit: { type: "number", description: "Maximum loops to return." }
    },
    required: ["projectName"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      loops: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "number" },
            status: { type: "string" },
            maxIterations: { type: "number" },
            stopReason: { type: ["string", "null"] },
            model: { type: ["string", "null"] },
            createdAt: { type: "string" },
            updatedAt: { type: "string" }
          },
          required: ["id", "status", "maxIterations", "createdAt", "updatedAt"],
          additionalProperties: false
        }
      },
      error: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          details: {}
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
      input: { projectName: "demo" },
      output: { ok: false, loops: [] }
    }
  ],
  tags: ["build", "loop"],
  filePath: "seed/server/src/kernel/tools/get_build_loops.ts"
};

export function getBuildLoopsTool(): ToolResult<GetBuildLoopsResult> {
  return {
    ok: false,
    error: {
      code: "NOT_ALLOWED",
      message: "get_build_loops is only available during build-loop runs."
    }
  };
}
