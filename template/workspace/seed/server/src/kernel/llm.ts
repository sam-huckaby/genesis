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
  apiKey: string,
  transcript: DiscoveryMessage[],
  options?: { logRaw?: (raw: string) => void }
): Promise<{ parsed: DiscoveryLlmResponse; raw: string }> {
  const systemPrompt =
    "You are a discovery assistant for a code generation seed. Ask clarifying questions until you can recommend a minimal MVP scaffold. Choose one of: nextjs (web UI apps), go_service (backend APIs/services when interoperability with many other languages or ecosystems is a priority), ocaml_dune (backend APIs/services when strong static types and correctness are a priority, or when OCaml/Dune/FP is requested; OCaml can serve APIs via Dream, though the ecosystem is smaller). Do not write code or provide build steps; discovery only. When ready, return a JSON object only. The JSON must include status, assistantMessage, recommendation (recommended + alternatives), draftBrief, suggestedName. draftBrief must be a string. suggestedName must be a lowercase slug string. If unknown, return empty strings. If more info is needed, set status=needs_more_info and ask 1-3 targeted questions. If ready, set status=ready and provide recommendation and draftBrief. You are observing the requests of a user to their builder agent. You may ask them questions to clarify their intent, but all of your output is going to be handed to the builder agent who is already waiting to begin work. Your job is to clearly understand the user's goal and suggest a language/framework so that they can make an informed decision when they begin working with their builder agent.";

  const messages = [
    { role: "system", content: systemPrompt },
    ...transcript.map((msg) => ({ role: msg.role, content: msg.content }))
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
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

  const content = data.choices?.[0]?.message?.content ?? "";
  options?.logRaw?.(content);
  const parsed = parseJsonResponse(content);
  return { parsed, raw: content };
}

function parseJsonResponse(raw: string): DiscoveryLlmResponse {
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
