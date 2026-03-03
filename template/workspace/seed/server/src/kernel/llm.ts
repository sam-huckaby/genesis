// LLM integration for the discovery flow (MVP recommendation only).
import type { OpenAiCredential } from "./openai_auth.js";

export type DiscoveryLlmResponse = {
  status: "needs_more_info" | "ready";
  assistantMessage: string;
  recommendation: {
    recommended: "nextjs" | "go_service" | "ocaml_dune";
    alternatives: { type: "nextjs" | "go_service" | "ocaml_dune"; why: string[] }[];
  };
  draftBrief?: string;
  suggestedName?: string;
};

type DiscoveryMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function runDiscoveryLlm(
  credential: OpenAiCredential,
  transcript: DiscoveryMessage[],
  options?: { logRaw?: (raw: string) => void }
): Promise<{ parsed: DiscoveryLlmResponse; raw: string }> {
  // Specialized discovery prompt: asks clarifying questions and returns JSON only.
  const systemPrompt =
    "You are a discovery assistant for a code generation seed. Ask clarifying questions until you can recommend a minimal MVP scaffold. Choose one of: nextjs (web UI apps), go_service (backend APIs/services when interoperability with many other languages or ecosystems is a priority), ocaml_dune (backend APIs/services when strong static types and correctness are a priority, or when OCaml/Dune/FP is requested; OCaml can serve APIs via Dream, though the ecosystem is smaller). Do not write code or provide build steps; discovery only. When ready, return a JSON object only. The JSON must include status, assistantMessage, recommendation (recommended + alternatives), draftBrief, suggestedName. draftBrief must be a string. suggestedName must be a lowercase slug string. If unknown, return empty strings. If more info is needed, set status=needs_more_info and ask 1-3 targeted questions. If ready, set status=ready and provide recommendation and draftBrief. You are observing the requests of a user to their builder agent. You may ask them questions to clarify their intent, but all of your output is going to be handed to the builder agent who is already waiting to begin work. Your job is to clearly understand the user's goal and suggest a language/framework so that they can make an informed decision when they begin working with their builder agent.";

  const content = await callDiscoveryModel(credential, systemPrompt, transcript);
  const raw = content;
  options?.logRaw?.(content);
  const parsed = parseJsonResponse(content);
  return { parsed, raw };
}

async function callDiscoveryModel(
  credential: OpenAiCredential,
  systemPrompt: string,
  transcript: DiscoveryMessage[]
): Promise<string> {
  if (credential.type === "api_key") {
    const messages = [
      { role: "system", content: systemPrompt },
      ...transcript.map((msg) => ({ role: msg.role, content: msg.content }))
    ];
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential.apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-5.2",
        messages,
        temperature: 0.2
      })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM request failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? "";
  }

  const input = transcript.map((msg) => ({
      type: "message",
      role: msg.role,
      content: msg.content
    }));

  const res = await fetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credential.accessToken}`,
      "OpenAI-Beta": "responses=experimental",
      originator: "codex_cli_rs",
      "chatgpt-account-id": credential.accountId
    },
    body: JSON.stringify({
      model: "gpt-5.2",
      instructions: systemPrompt,
      input,
      store: false,
      stream: true,
      reasoning: {
        effort: "medium",
        summary: "auto"
      },
      text: {
        verbosity: "medium"
      },
      include: ["reasoning.encrypted_content"]
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM request failed: ${res.status} ${text}`);
  }

  const data = (await readCodexResponsePayload(res)) as {
    output?: Array<{
      type?: string;
      role?: string;
      content?: Array<{ type?: string; text?: string }> | string;
    }>;
  };

  const output = extractAssistantTextFromResponse(data.output ?? []);
  if (!output) {
    throw new Error("LLM response missing assistant output");
  }
  return output;
}

async function readCodexResponsePayload(res: Response): Promise<unknown> {
  const raw = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      // Some Codex responses are SSE-formatted even when headers are inconsistent.
    }
  }

  const sse = raw;
  const lines = sse.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) {
      continue;
    }
    try {
      const payload = JSON.parse(line.slice(6)) as {
        type?: string;
        response?: unknown;
      };
      if (payload.type === "response.done" || payload.type === "response.completed") {
        return payload.response ?? {};
      }
    } catch {
      // Ignore malformed SSE chunks.
    }
  }
  throw new Error("LLM response did not contain a final response payload");
}

function extractAssistantTextFromResponse(
  output: Array<{
    type?: string;
    role?: string;
    content?: Array<{ type?: string; text?: string }> | string;
  }>
): string {
  const chunks: string[] = [];
  for (const item of output) {
    if (item.type !== "message" || item.role !== "assistant") {
      continue;
    }
    if (typeof item.content === "string") {
      chunks.push(item.content);
      continue;
    }
    if (!Array.isArray(item.content)) {
      continue;
    }
    for (const part of item.content) {
      if (typeof part.text === "string" && part.text.length > 0) {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function parseJsonResponse(raw: string): DiscoveryLlmResponse {
  // Tolerate extra text by extracting the first JSON object if needed.
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as DiscoveryLlmResponse;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("LLM response did not contain JSON");
    }
    return JSON.parse(match[0]) as DiscoveryLlmResponse;
  }
}
