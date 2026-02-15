import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { TOOL_SPECS } from "./tools/tool_specs.js";
import { listFiles } from "./tools/list_files.js";
import { readFileTool } from "./tools/read_file.js";
import { readFiles } from "./tools/read_files.js";
import { statPath } from "./tools/stat.js";
import { grep } from "./tools/grep.js";
import { projectInfo } from "./tools/project_info.js";
import { applyPatchTool } from "./tools/apply_patch_tool.js";
import { applyUnifiedDiff } from "./tools/apply_patch.js";
import { editFile } from "./tools/edit_file.js";
import { gitStatus } from "./tools/git_status.js";
import { gitDiff } from "./tools/git_diff.js";
import { searchToolsTool } from "./tools/search_tools.js";
import { describeTool } from "./tools/describe_tool.js";
import { buildLoopStartTool } from "./tools/build_loop_start.js";
import { buildLoopStopTool } from "./tools/build_loop_stop.js";
import { getBuildLoopsTool } from "./tools/get_build_loops.js";
import { getBuildLoopDetailTool } from "./tools/get_build_loop_detail.js";
import { buildToolMeta } from "./project_chat_meta.js";
import type { ToolResult } from "./tools/tool_result.js";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ToolCall = {
  id: string;
  function: { name: string; arguments: string };
};

type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

const TOOL_DEFS = TOOL_SPECS.map((spec) => ({
  type: "function",
  function: {
    name: spec.name,
    description: spec.description,
    parameters: spec.argsSchema
  }
}));

type ChatMode = "plan" | "build";

type ToolStartPayload = {
  toolName: string;
  toolMeta: string;
  createdAt: string;
};

type ToolEndPayload = {
  messageId: number;
  status: "running" | "done" | "error";
  summary?: string;
};

type ToolExecutor = (
  call: ToolCall,
  mode: ChatMode
) => Promise<ToolResult<unknown> | null> | ToolResult<unknown> | null;

type ToolContext = {
  workspaceDir: string;
  projectRootAbs: string;
  projectRootRel: string;
  allowedRootAbs: string;
};

type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult<unknown>>;

function buildSystemPrompt(projectRootRel: string, mode: ChatMode): string {
  return (
    "You are a project assistant working inside a project workspace. " +
    `Project root: ${projectRootRel}. ` +
    `Mode: ${mode}. ` +
    "You may only call the available tools. " +
    "Use search_tools to discover tools and describe_tool for full schemas. " +
    "Use edit_file for small, targeted edits (preferred). " +
    "Use apply_patch for V4A headerless patch operations (operations array). " +
    "Use apply_unified_diff for large, multi-file unified diffs only. " +
    "Do not provide allowedRootAbs; the system injects it. " +
    "Do not output TypeScript code blocks for execution. " +
    "Do not access secrets, env files, keys, or build artifacts."
  );
}

async function callOpenAi(
  apiKey: string,
  messages: OpenAiMessage[],
  tools: typeof TOOL_DEFS,
  model: string
): Promise<{ message: OpenAiMessage; toolCalls?: ToolCall[]; raw: string }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      temperature: 0.2
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM request failed: ${res.status} ${text}`);
  }

  const raw = await res.text();
  const data = JSON.parse(raw) as {
    choices: { message: OpenAiMessage }[];
  };
  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error("LLM response missing message");
  }
  return { message, toolCalls: message.tool_calls, raw };
}

function resolveRootArg(
  input: unknown,
  workspaceDir: string,
  projectRootAbs: string
): string {
  if (typeof input === "string" && input.trim().length > 0) {
    return path.isAbsolute(input) ? input : path.resolve(workspaceDir, input);
  }
  return projectRootAbs;
}

function invalidArgs(message: string, details?: unknown): ToolResult<unknown> {
  return { ok: false, error: { code: "INVALID_ARGS", message, details } };
}

function normalizeToolName(name: string): string {
  return name.replace(/^functions\./, "");
}

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  list_files: async (args, context) => {
    const root = resolveRootArg(args.root, context.workspaceDir, context.projectRootAbs);
    return listFiles({
      root,
      globs: Array.isArray(args.globs) ? (args.globs as string[]) : undefined,
      maxDepth: typeof args.maxDepth === "number" ? args.maxDepth : undefined,
      maxResults: typeof args.maxResults === "number" ? args.maxResults : undefined,
      includeDirs: typeof args.includeDirs === "boolean" ? args.includeDirs : undefined
    });
  },
  read_file: async (args, context) => {
    const root = resolveRootArg(args.root, context.workspaceDir, context.projectRootAbs);
    const filePath = typeof args.path === "string" ? args.path : "";
    if (!filePath) {
      return invalidArgs("Missing path");
    }
    const range = typeof args.range === "object" && args.range
      ? (args.range as { startLine?: number; endLine?: number })
      : undefined;
    return readFileTool({
      root,
      path: filePath,
      maxBytes: typeof args.maxBytes === "number" ? args.maxBytes : undefined,
      range
    });
  },
  read_files: async (args, context) => {
    const root = resolveRootArg(args.root, context.workspaceDir, context.projectRootAbs);
    const paths = Array.isArray(args.paths) ? (args.paths as string[]) : [];
    if (paths.length === 0) {
      return invalidArgs("Missing paths");
    }
    return readFiles({
      root,
      paths,
      maxBytesEach: typeof args.maxBytesEach === "number" ? args.maxBytesEach : undefined,
      maxTotalBytes: typeof args.maxTotalBytes === "number" ? args.maxTotalBytes : undefined
    });
  },
  stat: async (args, context) => {
    const root = resolveRootArg(args.root, context.workspaceDir, context.projectRootAbs);
    const targetPath = typeof args.path === "string" ? args.path : "";
    if (!targetPath) {
      return invalidArgs("Missing path");
    }
    return statPath({ root, path: targetPath });
  },
  grep: async (args, context) => {
    const root = resolveRootArg(args.root, context.workspaceDir, context.projectRootAbs);
    const query = typeof args.query === "string" ? args.query : "";
    if (!query) {
      return invalidArgs("Missing query");
    }
    return grep({
      root,
      query,
      isRegex: typeof args.isRegex === "boolean" ? args.isRegex : undefined,
      caseSensitive: typeof args.caseSensitive === "boolean" ? args.caseSensitive : undefined,
      globs: Array.isArray(args.globs) ? (args.globs as string[]) : undefined,
      maxResults: typeof args.maxResults === "number" ? args.maxResults : undefined,
      maxFiles: typeof args.maxFiles === "number" ? args.maxFiles : undefined
    });
  },
  project_info: async (args, context) => {
    const root = resolveRootArg(args.root, context.workspaceDir, context.projectRootAbs);
    return projectInfo({ root });
  },
  edit_file: async (args, context) => {
    const filePath = typeof args.path === "string" ? args.path : "";
    const expectedSha256 = typeof args.expectedSha256 === "string" ? args.expectedSha256 : "";
    const mode = typeof args.mode === "string" ? args.mode : "";
    if (!filePath || !expectedSha256 || !mode) {
      return invalidArgs("Missing required fields for edit_file");
    }

    if (mode === "anchor_replace") {
      const before = args.before as unknown;
      const after = args.after as unknown;
      const replacement = typeof args.replacement === "string" ? args.replacement : "";
      if (!before || !after || !replacement) {
        return invalidArgs("Missing anchors or replacement for anchor_replace");
      }
      return editFile({
        allowedRootAbs: context.allowedRootAbs,
        path: filePath,
        expectedSha256,
        mode: "anchor_replace",
        before: before as any,
        after: after as any,
        replacement,
        expectedOccurrences:
          typeof args.expectedOccurrences === "number" ? args.expectedOccurrences : undefined,
        searchFrom: typeof args.searchFrom === "number" ? args.searchFrom : undefined
      });
    }

    if (mode === "insert_after") {
      const anchor = args.anchor as unknown;
      const text = typeof args.text === "string" ? args.text : "";
      if (!anchor || !text) {
        return invalidArgs("Missing anchor or text for insert_after");
      }
      return editFile({
        allowedRootAbs: context.allowedRootAbs,
        path: filePath,
        expectedSha256,
        mode: "insert_after",
        anchor: anchor as any,
        text,
        expectedOccurrences:
          typeof args.expectedOccurrences === "number" ? args.expectedOccurrences : undefined,
        searchFrom: typeof args.searchFrom === "number" ? args.searchFrom : undefined
      });
    }

    if (mode === "append") {
      const text = typeof args.text === "string" ? args.text : "";
      if (!text) {
        return invalidArgs("Missing text for append");
      }
      return editFile({
        allowedRootAbs: context.allowedRootAbs,
        path: filePath,
        expectedSha256,
        mode: "append",
        text
      });
    }

    return invalidArgs("Unsupported edit_file mode", { mode });
  },
  apply_patch: async (args, context) => {
    const operations = Array.isArray(args.operations)
      ? (args.operations as Array<{ type?: string; path?: string; diff?: string }>)
      : [];
    if (operations.length === 0) {
      return invalidArgs("Missing operations");
    }
    return applyPatchTool({
      allowedRootAbs: context.allowedRootAbs,
      operations: operations.map((operation) => ({
        type: operation.type as "create_file" | "update_file" | "delete_file",
        path: typeof operation.path === "string" ? operation.path : "",
        diff: typeof operation.diff === "string" ? operation.diff : undefined
      })),
      limits: typeof args.limits === "object" && args.limits
        ? (args.limits as { maxPatchBytes?: number; maxFileBytes?: number })
        : undefined
    });
  },
  apply_unified_diff: async (args, context) => {
    const patchText = typeof args.patchText === "string" ? args.patchText : "";
    if (!patchText) {
      return invalidArgs("Missing patchText");
    }
    const limits = typeof args.limits === "object" && args.limits
      ? (args.limits as { maxFiles?: number; maxPatchBytes?: number; maxFileBytes?: number })
      : undefined;
    return applyUnifiedDiff({
      allowedRootAbs: context.allowedRootAbs,
      patchText,
      limits
    });
  },
  git_status: async (args, context) => {
    const root = resolveRootArg(args.root, context.workspaceDir, context.projectRootAbs);
    return gitStatus({ root });
  },
  git_diff: async (args, context) => {
    const root = resolveRootArg(args.root, context.workspaceDir, context.projectRootAbs);
    return gitDiff({
      root,
      ref: typeof args.ref === "string" ? args.ref : undefined,
      staged: typeof args.staged === "boolean" ? args.staged : undefined,
      maxBytes: typeof args.maxBytes === "number" ? args.maxBytes : undefined
    });
  },
  search_tools: async (args, context) => {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query) {
      return invalidArgs("Missing query");
    }
    return searchToolsTool(context.workspaceDir, {
      query,
      limit: typeof args.limit === "number" ? args.limit : undefined
    });
  },
  describe_tool: async (args, context) => {
    const name = typeof args.name === "string" ? args.name : "";
    if (!name) {
      return invalidArgs("Missing name");
    }
    return describeTool(context.workspaceDir, { name });
  },
  build_loop_start: async () => buildLoopStartTool(),
  build_loop_stop: async () => buildLoopStopTool(),
  get_build_loops: async () => getBuildLoopsTool(),
  get_build_loop_detail: async () => getBuildLoopDetailTool()
};

async function runToolCall(
  workspaceDir: string,
  projectRootAbs: string,
  projectRootRel: string,
  allowedRootAbs: string,
  call: ToolCall
): Promise<ToolResult<unknown>> {
  const toolName = normalizeToolName(call.function.name);
  let args: Record<string, unknown> = {};
  try {
    args = call.function.arguments
      ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
      : {};
  } catch {
    return invalidArgs("Invalid tool arguments");
  }

  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return { ok: false, error: { code: "NOT_FOUND", message: "Unknown tool" } };
  }

  return handler(args, { workspaceDir, projectRootAbs, projectRootRel, allowedRootAbs });
}

export async function runProjectChatLlm(params: {
  apiKey: string;
  workspaceDir: string;
  projectRootAbs: string;
  projectRootRel: string;
  history: ChatMessage[];
  mode: ChatMode;
  maxIterations?: number;
  logPath?: string;
  systemPromptOverride?: string;
  modelOverride?: string;
  onToolStart?: (payload: ToolStartPayload) => Promise<number> | number;
  onToolEnd?: (payload: ToolEndPayload) => Promise<void> | void;
  toolExecutor?: ToolExecutor;
}): Promise<string> {
  const systemPrompt = params.systemPromptOverride?.trim().length
    ? params.systemPromptOverride
    : buildSystemPrompt(params.projectRootRel, params.mode);
  const tools = TOOL_DEFS;
  const model = params.modelOverride?.trim().length ? params.modelOverride : "gpt-5.2";
  const allowedRootAbs = await fsPromises.realpath(params.projectRootAbs);
  const messages: OpenAiMessage[] = [
    { role: "system", content: systemPrompt },
    ...params.history.map((msg) => ({ role: msg.role, content: msg.content }))
  ];

  const maxIterations =
    typeof params.maxIterations === "number" && Number.isFinite(params.maxIterations)
      ? Math.max(1, Math.floor(params.maxIterations))
      : 100;
  for (let i = 0; i < maxIterations; i += 1) {
    const { message, toolCalls, raw } = await callOpenAi(
      params.apiKey,
      messages,
      tools,
      model
    );
    if (params.logPath) {
      fs.mkdirSync(path.dirname(params.logPath), { recursive: true });
      fs.appendFileSync(params.logPath, `${raw}\n\n`, "utf8");
    }
    if (toolCalls && toolCalls.length > 0) {
      messages.push({ role: "assistant", content: message.content ?? "", tool_calls: toolCalls });

      const executeTool = async (call: ToolCall): Promise<ToolResult<unknown>> => {
        if (params.toolExecutor) {
          const handled = await params.toolExecutor(call, params.mode);
          if (handled) {
            return handled;
          }
        }
        return runToolCall(
          params.workspaceDir,
          params.projectRootAbs,
          params.projectRootRel,
          allowedRootAbs,
          call
        );
      };

      for (const call of toolCalls) {
        const toolMeta = buildToolMeta(call);
        let toolMessageId: number | null = null;
        if (params.onToolStart) {
          const createdAt = new Date().toISOString();
          const maybeId = await params.onToolStart({
            toolName: call.function.name,
            toolMeta,
            createdAt
          });
          toolMessageId = typeof maybeId === "number" ? maybeId : null;
        }

        const result = await executeTool(call);
        if (params.onToolEnd && toolMessageId) {
          await params.onToolEnd({
            messageId: toolMessageId,
            status: result.ok ? "done" : "error",
            summary: result.ok ? undefined : result.error.message
          });
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result)
        });
      }
      continue;
    }

    const finalContent = message.content?.trim();
    return finalContent && finalContent.length > 0
      ? finalContent
      : "Model returned an empty response.";
  }

  return "Tool loop did not converge.";
}
