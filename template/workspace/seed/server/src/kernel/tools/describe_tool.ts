import type { ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";
import { getToolContractByName } from "../tool_registry.js";

// Tool wrapper that returns full tool metadata from the registry.
export type DescribeToolArgs = { name: string };

export type DescribeToolResult = {
  name: string;
  description: string;
  argsSchema: unknown;
  returnsSchema: unknown;
  examples?: Array<{ input: unknown; output: unknown }>;
  tags?: string[];
  filePath?: string;
};

export const spec: ToolSpec = {
  name: "describe_tool",
  description: "Return full details for a tool, including JSON schemas and examples.",
  argsSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Tool name." }
    },
    required: ["name"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      name: { type: "string" },
      description: { type: "string" },
      argsSchema: { type: "object" },
      returnsSchema: { type: "object" },
      examples: { type: "array" },
      tags: { type: "array" },
      filePath: { type: "string" },
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
      input: { name: "read_file" },
      output: { ok: true, name: "read_file", description: "", argsSchema: {}, returnsSchema: {} }
    }
  ],
  tags: ["tools", "describe"],
  filePath: "seed/server/src/kernel/tools/describe_tool.ts"
};

export async function describeTool(
  workspaceDir: string,
  args: DescribeToolArgs
): Promise<ToolResult<DescribeToolResult>> {
  try {
    // Normalize any "functions." prefix from tool calls.
    const normalizedName = args.name.replace(/^functions\./, "");
    const tool = getToolContractByName(workspaceDir, normalizedName);
    if (!tool) {
      return { ok: false, error: { code: "NOT_FOUND", message: `Tool not found: ${args.name}` } };
    }
    return {
      ok: true,
      name: tool.name,
      description: tool.description,
      argsSchema: tool.argsSchema,
      returnsSchema: tool.returnsSchema,
      examples: tool.examples,
      tags: tool.tags,
      filePath: tool.filePath
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: error instanceof Error ? error.message : "describe_tool failed",
        details: error
      }
    };
  }
}
