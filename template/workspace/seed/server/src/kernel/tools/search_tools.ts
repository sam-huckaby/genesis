import type { ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";
import { searchTools } from "../tool_registry.js";

export type SearchToolsArgs = {
  query: string;
  limit?: number;
};

export type ToolSummary = {
  name: string;
  description: string;
  argsSchema: unknown;
  returnsSchema: unknown;
  examples?: Array<{ input: unknown; output: unknown }>;
};

export type SearchToolsResult = {
  tools: ToolSummary[];
};

export const spec: ToolSpec = {
  name: "search_tools",
  description: "Search available tools by keyword and return minimal schemas.",
  argsSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query." },
      limit: { type: "number", description: "Maximum number of tools to return." }
    },
    required: ["query"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      tools: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            argsSchema: { type: "object" },
            returnsSchema: { type: "object" },
            examples: { type: "array" }
          },
          required: ["name", "description", "argsSchema", "returnsSchema"],
          additionalProperties: false
        }
      }
    },
    required: ["tools"],
    additionalProperties: false
  },
  examples: [
    {
      input: { query: "read file" },
      output: { ok: true, result: { tools: [] } }
    }
  ],
  tags: ["tools", "search"],
  filePath: "seed/server/src/kernel/tools/search_tools.ts"
};

export async function searchToolsTool(
  workspaceDir: string,
  args: SearchToolsArgs
): Promise<ToolResult<SearchToolsResult>> {
  try {
    const rawLimit = args.limit ?? 10;
    const topK = Math.max(1, Math.min(20, Math.floor(rawLimit)));
    const result = searchTools(workspaceDir, args.query, topK);
    const tools = result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      argsSchema: tool.argsSchema,
      returnsSchema: tool.returnsSchema,
      examples: tool.examples
    }));

    return { ok: true, result: { tools } };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: error instanceof Error ? error.message : "search_tools failed",
        details: error
      }
    };
  }
}
