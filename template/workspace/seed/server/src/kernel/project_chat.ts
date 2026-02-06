import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  diffTouchesSensitivePath,
  extractDiffPaths,
  isSensitivePath,
  listProjectFiles,
  readProjectFile
} from "../util/project_files.js";

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

const TOOL_DEFS_READ = [
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List project files. Provide a relative path within the project (default '.') and optional limits.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path within project" },
          maxDepth: { type: "number", description: "Max directory depth" },
          maxEntries: { type: "number", description: "Max number of files" }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file by relative path within the project.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" }
        },
        required: ["path"],
        additionalProperties: false
      }
    }
  }
];

const TOOL_DEFS_BUILD = [
  ...TOOL_DEFS_READ,
  {
    type: "function",
    function: {
      name: "patch_file",
      description:
        "Apply a patch using apply_patch format. Use *** Begin Patch and *** End Patch blocks. " +
        "Supports *** Update File, *** Add File, and *** Delete File. " +
        "For updates, include @@ hunks and prefix lines with space, +, or -. " +
        "Example:\n" +
        "*** Begin Patch\n" +
        "*** Update File: app/page.tsx\n" +
        "@@\n" +
        "-console.log('old');\n" +
        "+console.log('new');\n" +
        "*** End Patch\n",
      parameters: {
        type: "object",
        properties: {
          diff: { type: "string", description: "Unified diff patch" }
        },
        required: ["diff"],
        additionalProperties: false
      }
    }
  }
];

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

type ToolResult = { ok: boolean; result?: unknown; error?: string };

type ToolExecutor = (call: ToolCall, mode: ChatMode) => Promise<ToolResult | null> | ToolResult | null;

function buildSystemPrompt(projectRootRel: string, mode: ChatMode): string {
  return (
    "You are a project assistant working inside a project workspace. " +
    `Project root: ${projectRootRel}. ` +
    `Mode: ${mode}. ` +
    "Always respond with a normal assistant message when no tools are needed. " +
    "Use list_files and read_file to inspect code. " +
    "In build mode you may use patch_file to propose edits using apply_patch format. " +
    "Do not use unified diff format. " +
    "Do not access sensitive files (secrets, env files, keys) or build artifacts."
  );
}

async function callOpenAi(
  apiKey: string,
  messages: OpenAiMessage[],
  tools: typeof TOOL_DEFS_READ | typeof TOOL_DEFS_BUILD
): Promise<{ message: OpenAiMessage; toolCalls?: ToolCall[]; raw: string }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-5.2",
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

async function runToolCall(
  projectRootAbs: string,
  call: ToolCall,
  mode: ChatMode
): Promise<ToolResult> {
  let args: Record<string, unknown> = {};
  try {
    args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
  } catch {
    return { ok: false, error: "Invalid tool arguments" };
  }

  if (call.function.name === "list_files") {
    const pathArg = typeof args.path === "string" ? args.path : ".";
    const maxDepth = typeof args.maxDepth === "number" ? args.maxDepth : undefined;
    const maxEntries = typeof args.maxEntries === "number" ? args.maxEntries : undefined;
    const result = listProjectFiles(projectRootAbs, { startPath: pathArg, maxDepth, maxEntries });
    return { ok: true, result };
  }

  if (call.function.name === "read_file") {
    const pathArg = typeof args.path === "string" ? args.path : "";
    if (!pathArg) {
      return { ok: false, error: "Missing path" };
    }
    try {
      const result = readProjectFile(projectRootAbs, pathArg);
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  if (call.function.name === "patch_file") {
    if (mode !== "build") {
      return { ok: false, error: "patch_file not available in plan mode" };
    }
    const diff = typeof args.diff === "string" ? args.diff : "";
    if (!diff.trim()) {
      return { ok: false, error: "Missing diff" };
    }
    if (diff.trimStart().startsWith("*** Begin Patch")) {
      return {
        ok: false,
        error: "Use unified diff format (git apply). apply_patch is not supported."
      };
    }
    if (diffTouchesSensitivePath(diff)) {
      return { ok: false, error: "Patch touches sensitive or excluded paths" };
    }
    const diffPaths = extractDiffPaths(diff);
    if (diffPaths.some((p) => p.startsWith("..") || path.posix.isAbsolute(p))) {
      return { ok: false, error: "Invalid patch path" };
    }
    try {
      execFileSync("git", ["apply", "-"], {
        cwd: projectRootAbs,
        input: diff,
        stdio: ["pipe", "pipe", "pipe"]
      });
      return { ok: true, result: { applied: true } };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  return { ok: false, error: "Unknown tool" };
}

export async function runProjectChatLlm(params: {
  apiKey: string;
  projectRootAbs: string;
  projectRootRel: string;
  history: ChatMessage[];
  mode: ChatMode;
  logPath?: string;
  onToolStart?: (payload: ToolStartPayload) => Promise<number> | number;
  onToolEnd?: (payload: ToolEndPayload) => Promise<void> | void;
  toolExecutor?: ToolExecutor;
}): Promise<string> {
  const systemPrompt = buildSystemPrompt(params.projectRootRel, params.mode);
  const tools = params.mode === "build" ? TOOL_DEFS_BUILD : TOOL_DEFS_READ;
  const messages: OpenAiMessage[] = [
    { role: "system", content: systemPrompt },
    ...params.history.map((msg) => ({ role: msg.role, content: msg.content }))
  ];

  const maxIterations = 8;
  for (let i = 0; i < maxIterations; i += 1) {
    const { message, toolCalls, raw } = await callOpenAi(params.apiKey, messages, tools);
    if (params.logPath) {
      fs.mkdirSync(path.dirname(params.logPath), { recursive: true });
      fs.appendFileSync(params.logPath, `${raw}\n\n`, "utf8");
    }
    if (toolCalls && toolCalls.length > 0) {
      messages.push({ role: "assistant", content: message.content ?? "", tool_calls: toolCalls });
      const readCalls = toolCalls.filter((call) => call.function.name === "read_file");
      const otherCalls = toolCalls.filter((call) => call.function.name !== "read_file");

      const executeTool = async (call: ToolCall): Promise<ToolResult> => {
        if (params.toolExecutor) {
          const handled = await params.toolExecutor(call, params.mode);
          if (handled) {
            return handled;
          }
        }
        return runToolCall(params.projectRootAbs, call, params.mode);
      };

      if (readCalls.length > 1) {
        let toolMessageId: number | null = null;
        if (params.onToolStart) {
          const createdAt = new Date().toISOString();
          const maybeId = await params.onToolStart({
            toolName: "read_file",
            toolMeta: `used on ${readCalls.length} files`,
            createdAt
          });
          toolMessageId = typeof maybeId === "number" ? maybeId : null;
        }

        let failures = 0;
        for (const call of readCalls) {
          const result = await executeTool(call);
          if (!result.ok) {
            failures += 1;
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result)
          });
        }

        if (params.onToolEnd && toolMessageId) {
          const summary =
            failures > 0
              ? `used on ${readCalls.length} files (${failures} failed)`
              : `used on ${readCalls.length} files`;
          await params.onToolEnd({
            messageId: toolMessageId,
            status: failures > 0 ? "error" : "done",
            summary
          });
        }
      } else {
        for (const call of readCalls) {
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
              summary: result.ok ? undefined : result.error
            });
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result)
          });
        }
      }

      for (const call of otherCalls) {
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
            summary: result.ok ? undefined : result.error
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

function buildToolMeta(call: ToolCall): string {
  let args: Record<string, unknown> = {};
  try {
    args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
  } catch {
    return call.function.name;
  }
  if (call.function.name === "list_files") {
    const pathArg = typeof args.path === "string" ? args.path : ".";
    return isSensitivePath(pathArg) ? "path=[blocked]" : `path=${pathArg}`;
  }
  if (call.function.name === "read_file") {
    const pathArg = typeof args.path === "string" ? args.path : "";
    if (!pathArg) {
      return "path=?";
    }
    return isSensitivePath(pathArg) ? "path=[blocked]" : `path=${pathArg}`;
  }
  if (call.function.name === "patch_file") {
    const diff = typeof args.diff === "string" ? args.diff : "";
    if (!diff.trim()) {
      return "patch";
    }
    if (diffTouchesSensitivePath(diff)) {
      return "files=[blocked]";
    }
    const paths = extractDiffPaths(diff);
    if (paths.length === 0) {
      return "files=unknown";
    }
    const preview = paths.slice(0, 3).join(", ");
    const extra = paths.length > 3 ? ` +${paths.length - 3}` : "";
    return `files=${preview}${extra}`;
  }
  return call.function.name;
}
