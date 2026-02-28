import type { ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";

// Stub tool spec: only available inside build-loop tool execution.
export type GetBuildLoopDetailArgs = {
  projectName: string;
  loopId: number;
};

export type BuildLoopIterationDetail = {
  id: number;
  iteration: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  assistantSummary?: string | null;
  createdAt: string;
};

export type BuildLoopDetail = {
  id: number;
  status: string;
  maxIterations: number;
  stopReason?: string | null;
  model?: string | null;
  createdAt: string;
  updatedAt: string;
  iterations: BuildLoopIterationDetail[];
};

export type GetBuildLoopDetailResult = {
  loop: BuildLoopDetail | null;
};

export const spec: ToolSpec = {
  name: "get_build_loop_detail",
  description: "Fetch a build loop with all iteration details.",
  argsSchema: {
    type: "object",
    properties: {
      projectName: { type: "string", description: "Project name." },
      loopId: { type: "number", description: "Build loop id." }
    },
    required: ["projectName", "loopId"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      loop: {
        type: ["object", "null"],
        properties: {
          id: { type: "number" },
          status: { type: "string" },
          maxIterations: { type: "number" },
          stopReason: { type: ["string", "null"] },
          model: { type: ["string", "null"] },
          createdAt: { type: "string" },
          updatedAt: { type: "string" },
          iterations: { type: "array" }
        },
        required: ["id", "status", "maxIterations", "createdAt", "updatedAt", "iterations"],
        additionalProperties: false
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
      input: { projectName: "demo", loopId: 1 },
      output: { ok: false, loop: null }
    }
  ],
  tags: ["build", "loop"],
  filePath: "seed/server/src/kernel/tools/get_build_loop_detail.ts"
};

export function getBuildLoopDetailTool(): ToolResult<GetBuildLoopDetailResult> {
  // The build-loop runner provides the actual implementation.
  return {
    ok: false,
    error: {
      code: "NOT_ALLOWED",
      message: "get_build_loop_detail is only available during build-loop runs."
    }
  };
}
