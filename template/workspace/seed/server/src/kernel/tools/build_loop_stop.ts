import type { ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";

// Stub tool spec: build loop stop is injected only during build loops.
export type BuildLoopStopArgs = {
  reason: string;
};

export type BuildLoopStopResult = {
  stopped: boolean;
  reason?: string;
};

export const spec: ToolSpec = {
  name: "build_loop_stop",
  description: "Stop the active build loop and provide a reason.",
  argsSchema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Why the build loop should stop." }
    },
    required: ["reason"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      stopped: { type: "boolean" },
      reason: { type: "string" },
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
      input: { reason: "Missing system dependency that requires user install." },
      output: { ok: false, stopped: false }
    }
  ],
  tags: ["build", "loop"],
  filePath: "seed/server/src/kernel/tools/build_loop_stop.ts"
};

export function buildLoopStopTool(): ToolResult<BuildLoopStopResult> {
  // Outside a build-loop context, this tool is rejected.
  return {
    ok: false,
    error: {
      code: "PRECONDITION_FAILED",
      message: "No active build-loop. Initiate with the build-loop endpoint."
    }
  };
}
