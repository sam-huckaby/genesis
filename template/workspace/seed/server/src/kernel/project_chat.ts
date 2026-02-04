import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  diffTouchesSensitivePath,
  extractDiffPaths,
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

const TOOL_DEFS = [
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
  },
  {
    type: "function",
    function: {
      name: "patch_file",
      description:
        "Apply a unified diff patch to project files. Use git-compatible unified diff format.",
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

function buildSystemPrompt(projectRootRel: string): string {
  return (
    "You are a build assistant working inside a project workspace. " +
    `Project root: ${projectRootRel}. ` +
    "Use list_files, read_file, and patch_file to inspect and modify the code. " +
    "When editing, prefer minimal unified diff patches. " +
    "Do not access sensitive files (secrets, env files, keys) or build artifacts."
  );
}

async function callOpenAi(
  apiKey: string,
  messages: OpenAiMessage[]
): Promise<{ message: OpenAiMessage; toolCalls?: ToolCall[] }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-5.2",
      messages,
      tools: TOOL_DEFS,
      temperature: 0.2
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM request failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    choices: { message: OpenAiMessage }[];
  };
  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error("LLM response missing message");
  }
  return { message, toolCalls: message.tool_calls };
}

async function runToolCall(
  projectRootAbs: string,
  call: ToolCall
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
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
    const diff = typeof args.diff === "string" ? args.diff : "";
    if (!diff.trim()) {
      return { ok: false, error: "Missing diff" };
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
}): Promise<string> {
  const systemPrompt = buildSystemPrompt(params.projectRootRel);
  const messages: OpenAiMessage[] = [
    { role: "system", content: systemPrompt },
    ...params.history.map((msg) => ({ role: msg.role, content: msg.content }))
  ];

  const maxIterations = 8;
  for (let i = 0; i < maxIterations; i += 1) {
    const { message, toolCalls } = await callOpenAi(params.apiKey, messages);
    if (toolCalls && toolCalls.length > 0) {
      messages.push({ role: "assistant", content: message.content ?? "", tool_calls: toolCalls });
      for (const call of toolCalls) {
        const result = await runToolCall(params.projectRootAbs, call);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result)
        });
      }
      continue;
    }

    const finalContent = message.content?.trim();
    return finalContent && finalContent.length > 0 ? finalContent : "No response.";
  }

  return "No response.";
}
