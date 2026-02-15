import type { ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";

export type BuildLoopStartArgs = {
  maxIterations?: number;
  modelOverride?: string;
};

export type BuildLoopStartResult = {
  result: {
    ok: boolean;
    loopId: number;
    lastIteration: unknown;
    message?: string;
  };
};

export const spec: ToolSpec = {
  name: "build_loop_start",
  description: "Start a build loop for the current project.",
  argsSchema: {
    type: "object",
    properties: {
      maxIterations: { type: "number", description: "Maximum build iterations." },
      modelOverride: { type: "string", description: "Optional model override." }
    },
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      result: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          loopId: { type: "number" },
          lastIteration: {},
          message: { type: "string" }
        },
        required: ["ok", "loopId", "lastIteration"],
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
      input: { maxIterations: 5 },
      output: { ok: false, result: { ok: false, loopId: 0, lastIteration: null } }
    }
  ],
  tags: ["build", "loop"],
  filePath: "seed/server/src/kernel/tools/build_loop_start.ts"
};

export function buildLoopStartTool(): ToolResult<BuildLoopStartResult> {
  return {
    ok: false,
    error: {
      code: "NOT_ALLOWED",
      message: "build_loop_start must be called from a project build loop context."
    }
  };
}
