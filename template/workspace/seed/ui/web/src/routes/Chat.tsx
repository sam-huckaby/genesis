import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode
} from "react";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "../api/client.js";
import Button from "../components/Button.js";
import ChatBubble from "../components/ChatBubble.js";
import type { ProjectChatMessage } from "@shared/types";

type Selection = {
  messageId: number;
  start: number;
  end: number;
};

function renderWithHighlights(text: string, selections: Selection[]): ReactNode[] {
  if (!selections.length) {
    return [text];
  }
  const ordered = [...selections].sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let cursor = 0;
  ordered.forEach((sel: Selection, index: number) => {
    if (sel.start > cursor) {
      parts.push(text.slice(cursor, sel.start));
    }
    parts.push(
      <mark key={`${sel.messageId}-${index}`}>{text.slice(sel.start, sel.end)}</mark>
    );
    cursor = sel.end;
  });
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts;
}

export default function Chat() {
  const [params] = useSearchParams();
  const project = params.get("project") ?? "";
  const [messages, setMessages] = useState<ProjectChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<"plan" | "build">("plan");
  const [activeSelection, setActiveSelection] = useState<Selection | null>(null);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);
  const containerRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const pendingPromptSent = useRef(false);

  const selectionByMessage = useMemo(() => {
    const map = new Map<number, Selection[]>();
    selections.forEach((sel: Selection) => {
      const list = map.get(sel.messageId) ?? [];
      list.push(sel);
      map.set(sel.messageId, list);
    });
    return map;
  }, [selections]);

  useEffect(() => {
    if (!project) {
      return;
    }
    const storedMode = window.localStorage.getItem(`seed.chatMode.${project}`);
    if (storedMode === "build" || storedMode === "plan") {
      setMode(storedMode);
    } else {
      setMode("plan");
      window.localStorage.setItem(`seed.chatMode.${project}`, "plan");
    }
    apiGet<{ messages: ProjectChatMessage[] }>(`/api/projects/${project}/messages`)
      .then((res) => {
        setMessages(res.messages ?? []);
        const loaded: Selection[] = [];
        (res.messages ?? []).forEach((msg: ProjectChatMessage) => {
          (msg.selections ?? []).forEach((sel: { start: number; end: number }) => {
            loaded.push({ messageId: msg.id, start: sel.start, end: sel.end });
          });
        });
        setSelections(loaded);
      })
      .catch(() => setMessages([]));
  }, [project]);

  useEffect(() => {
    if (!project || pendingPromptSent.current) {
      return;
    }
    pendingPromptSent.current = true;
    apiGet<{ prompt?: string }>(`/api/projects/${project}/build-prompt`)
      .then(async (res) => {
        if (!res.prompt) {
          return;
        }
        const response = await apiPost<{
          userMessage: ProjectChatMessage;
          assistantMessage: ProjectChatMessage;
        }>(`/api/projects/${project}/chat`, {
          role: "user",
          content: res.prompt,
          mode: "build"
        });
        setMessages((prev: ProjectChatMessage[]) =>
          sseConnected
            ? [...prev, response.userMessage]
            : [...prev, response.userMessage, response.assistantMessage]
        );
        await fetch(`/api/projects/${project}/build-prompt`, { method: "DELETE" });
      })
      .catch(() => {
        pendingPromptSent.current = false;
      });
  }, [project, sseConnected]);

  useEffect(() => {
    if (!project) {
      return;
    }
    const source = new EventSource(`/api/projects/${project}/chat/stream`);
    const handleMessage = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as ProjectChatMessage;
      setMessages((prev: ProjectChatMessage[]) => {
        const index = prev.findIndex((msg) => msg.id === payload.id);
        if (index === -1) {
          return [...prev, payload];
        }
        const next = [...prev];
        next[index] = { ...next[index], ...payload };
        return next;
      });
    };
    source.addEventListener("tool_created", handleMessage as EventListener);
    source.addEventListener("tool_updated", handleMessage as EventListener);
    source.addEventListener("assistant_message", handleMessage as EventListener);
    source.onopen = () => setSseConnected(true);
    source.onerror = () => setSseConnected(false);
    return () => {
      source.close();
      setSseConnected(false);
    };
  }, [project]);

  useEffect(() => {
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isNearBottom]);

  const handleScroll = () => {
    if (!scrollRef.current) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const distance = scrollHeight - scrollTop - clientHeight;
    setIsNearBottom(distance < 80);
  };

  const sendMessage = async () => {
    if (!input.trim() || !project) {
      return;
    }
    setIsSending(true);
    setMessage(null);
    const content = input.trim();
    setInput("");
    try {
      const res = await apiPost<{
        userMessage: ProjectChatMessage;
        assistantMessage: ProjectChatMessage;
      }>(`/api/projects/${project}/chat`, {
        role: "user",
        content,
        mode
      });
      setMessages((prev: ProjectChatMessage[]) =>
        sseConnected ? [...prev, res.userMessage] : [...prev, res.userMessage, res.assistantMessage]
      );
    } catch {
      setMessage("Chat request failed. Check API key.");
      setInput(content);
    } finally {
      setIsSending(false);
    }
  };

  const captureSelection = (messageId: number) => {
    const container = containerRefs.current[messageId];
    const selection = window.getSelection();
    if (!container || !selection || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      return;
    }
    const pre = range.cloneRange();
    pre.selectNodeContents(container);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    const selectedText = range.toString();
    const end = start + selectedText.length;
    if (!selectedText.trim()) {
      setActiveSelection(null);
      return;
    }
    setActiveSelection({ messageId, start, end });
  };

  const createTaskFromSelection = async () => {
    if (!activeSelection) {
      return;
    }
    await apiPost("/api/tasks/from-selection", {
      messageId: activeSelection.messageId,
      start: activeSelection.start,
      end: activeSelection.end
    });
    setSelections((prev: Selection[]) => [...prev, activeSelection]);
    setActiveSelection(null);
  };

  if (!project) {
    return (
      <section>
        <h1>Chat</h1>
        <p>Select a project from Onboarding first.</p>
      </section>
    );
  }

  return (
    <section className="project-chat-shell">
      <h1 class="app-heading">Project chat</h1>
      <p>Project: {project}</p>

      <div className="discovery-chat project-chat">
        <div className="chat-scroll" ref={scrollRef} onScroll={handleScroll}>
          {messages.length === 0 ? <p className="muted">No messages yet.</p> : null}
          {messages.map((msg) => {
            const isTool = msg.kind === "tool";
            const selectionsForMessage = selectionByMessage.get(msg.id) ?? [];
            const content =
              !isTool && selectionsForMessage.length
                ? renderWithHighlights(msg.content, selectionsForMessage)
                : null;
            const toolLabel = msg.toolName
              ? [msg.toolName, msg.toolMeta ?? ""].filter(Boolean).join(" ")
              : msg.content;
            return (
              <div
                key={msg.id}
                ref={(el) => {
                  if (msg.role === "assistant" && !isTool) {
                    containerRefs.current[msg.id] = el;
                  }
                }}
                onMouseUp={() => {
                  if (msg.role === "assistant" && !isTool) {
                    captureSelection(msg.id);
                  }
                }}
              >
                {isTool ? (
                  <ChatBubble
                    kind="tool"
                    toolName={msg.toolName ?? "tool"}
                    toolMeta={msg.toolMeta ?? toolLabel}
                    status={msg.status}
                  />
                ) : (
                  <ChatBubble role={msg.role} content={msg.content}>
                    {content ? <span className="chat-bubble-text">{content}</span> : null}
                  </ChatBubble>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        {!isNearBottom ? (
          <div className="scroll-to-bottom">
            <Button
              variant="icon"
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M12 4v12m0 0l-5-5m5 5l5-5"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              }
              onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
              aria-label="Scroll to bottom"
            />
          </div>
        ) : null}
        <div className="chat-composer">
          {message ? <div className="error-indicator">{message}</div> : null}
          <label>
            Mode
            <select
              value={mode}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const nextMode = event.target.value === "build" ? "build" : "plan";
                setMode(nextMode);
                window.localStorage.setItem(`seed.chatMode.${project}`, nextMode);
              }}
            >
              <option value="plan">Plan (read only)</option>
              <option value="build">Build (read + write)</option>
            </select>
          </label>
          <textarea
            rows={4}
            value={input}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              setInput(event.target.value)
            }
            placeholder="Ask for changes or continue building..."
          />
          <div className="card-actions">
            <Button type="button" onClick={sendMessage} disabled={isSending}>
              {isSending ? "Sending..." : "Send"}
            </Button>
            {activeSelection ? (
              <Button type="button" variant="secondary" onClick={createTaskFromSelection}>
                Create task from selection
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
