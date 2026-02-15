import {
  useCallback,
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
import { replaceTempMessage, upsertMessages } from "../lib/chat_messages.js";
import type { ProjectChatConversation, ProjectChatMessage } from "@shared/types";

type Selection = {
  messageId: number;
  start: number;
  end: number;
};

type PendingUserMessage = {
  tempId: number;
  content: string;
  conversationId: number;
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
  const modeParam = params.get("mode");
  const [conversations, setConversations] = useState<ProjectChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ProjectChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<"plan" | "build">("plan");
  const [activeSelection, setActiveSelection] = useState<Selection | null>(null);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const pendingUserMessagesRef = useRef<PendingUserMessage[]>([]);
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

  const loadConversations = useCallback(
    async (preferId?: number) => {
      if (!project) {
        return;
      }
      try {
        const res = await apiGet<{ conversations: ProjectChatConversation[] }>(
          `/api/projects/${project}/conversations`
        );
        const nextConversations = res.conversations ?? [];
        setConversations(nextConversations);
        const preferred =
          preferId && nextConversations.some((conv) => conv.id === preferId)
            ? preferId
            : nextConversations[0]?.id ?? null;
        setActiveConversationId(preferred ?? null);
        if (preferred) {
          await apiPost(`/api/projects/${project}/conversations/${preferred}/view`, {});
        } else {
          setMessages([]);
          setSelections([]);
        }
      } catch {
        setConversations([]);
        setActiveConversationId(null);
        setMessages([]);
        setSelections([]);
      }
    },
    [project]
  );

  const createConversation = useCallback(
    async (title?: string) => {
      if (!project) {
        return null;
      }
      const res = await apiPost<{ conversation: ProjectChatConversation }>(
        `/api/projects/${project}/conversations`,
        { title: title ?? "Conversation" }
      );
      const conversation = res.conversation;
      setConversations((prev: ProjectChatConversation[]) => [
        conversation,
        ...prev.filter((conv: ProjectChatConversation) => conv.id !== conversation.id)
      ]);
      setActiveConversationId(conversation.id);
      await apiPost(`/api/projects/${project}/conversations/${conversation.id}/view`, {});
      setIsSidebarOpen(false);
      return conversation.id;
    },
    [project]
  );

  const ensureActiveConversation = useCallback(
    async (title?: string) => {
      if (!project) {
        return null;
      }
      if (activeConversationId) {
        return activeConversationId;
      }
      return createConversation(title ?? "Conversation");
    },
    [project, activeConversationId, createConversation]
  );

  const selectConversation = useCallback(
    async (id: number) => {
      if (!project) {
        return;
      }
      setActiveConversationId(id);
      await apiPost(`/api/projects/${project}/conversations/${id}/view`, {});
      loadConversations(id);
      setIsSidebarOpen(false);
    },
    [project, loadConversations]
  );

  useEffect(() => {
    if (!project) {
      return;
    }
    if (modeParam === "build" || modeParam === "plan") {
      setMode(modeParam);
      window.localStorage.setItem(`seed.chatMode.${project}`, modeParam);
    }
    if (modeParam !== "build" && modeParam !== "plan") {
      const storedMode = window.localStorage.getItem(`seed.chatMode.${project}`);
      if (storedMode === "build" || storedMode === "plan") {
        setMode(storedMode);
      } else {
        setMode("plan");
        window.localStorage.setItem(`seed.chatMode.${project}`, "plan");
      }
    }
    loadConversations();
  }, [project, modeParam, loadConversations]);

  useEffect(() => {
    if (!project || !activeConversationId) {
      setMessages([]);
      setSelections([]);
      setActiveSelection(null);
      return;
    }
    setIsLoadingMessages(true);
    apiGet<{ messages: ProjectChatMessage[] }>(
      `/api/projects/${project}/conversations/${activeConversationId}/messages`
    )
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
      .catch(() => {
        setMessages([]);
        setSelections([]);
      })
      .finally(() => setIsLoadingMessages(false));
  }, [project, activeConversationId]);

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
        const tempId = -Date.now();
        const tempMessage: ProjectChatMessage = {
          id: tempId,
          role: "user",
          content: res.prompt,
          createdAt: new Date().toISOString(),
          kind: "message"
        };
        setMessages((prev: ProjectChatMessage[]) => [...prev, tempMessage]);
        try {
          const conversationId = await ensureActiveConversation(res.prompt);
          if (!conversationId) {
            throw new Error("No conversation available");
          }
          const response = await apiPost<{
            userMessage: ProjectChatMessage;
            assistantMessage: ProjectChatMessage;
          }>(`/api/projects/${project}/chat`, {
            role: "user",
            content: res.prompt,
            mode: "build",
            conversationId
          });
          setMessages((prev: ProjectChatMessage[]) => {
            const withUser = replaceTempMessage(prev, tempId, response.userMessage);
            if (sseConnected) {
              return withUser;
            }
            return upsertMessages(withUser, [response.assistantMessage]);
          });
          loadConversations(conversationId);
          await fetch(`/api/projects/${project}/build-prompt`, { method: "DELETE" });
        } catch {
          setMessages((prev: ProjectChatMessage[]) => prev.filter((msg) => msg.id !== tempId));
          pendingPromptSent.current = false;
        }
      })
      .catch(() => {
        pendingPromptSent.current = false;
      });
  }, [project, sseConnected, ensureActiveConversation, loadConversations]);

  useEffect(() => {
    if (!project || !activeConversationId) {
      return;
    }
    const source = new EventSource(
      `/api/projects/${project}/chat/stream?conversationId=${activeConversationId}`
    );
    const handleMessage = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as ProjectChatMessage;
      if (payload.role === "user" && payload.conversationId) {
        const pendingIndex = pendingUserMessagesRef.current.findIndex(
          (entry: PendingUserMessage) =>
            entry.conversationId === payload.conversationId && entry.content === payload.content
        );
        if (pendingIndex >= 0) {
          const [pending] = pendingUserMessagesRef.current.splice(pendingIndex, 1);
          setMessages((prev: ProjectChatMessage[]) =>
            replaceTempMessage(prev, pending.tempId, payload)
          );
          return;
        }
      }
      setMessages((prev: ProjectChatMessage[]) => {
        if (payload.conversationId && payload.conversationId !== activeConversationId) {
          return prev;
        }
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
    source.addEventListener("user_message", handleMessage as EventListener);
    source.onopen = () => setSseConnected(true);
    source.onerror = () => setSseConnected(false);
    return () => {
      source.close();
      setSseConnected(false);
    };
  }, [project, activeConversationId]);

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
    if (!input.trim() || !project || isSending) {
      return;
    }
    const content = input.trim();
    const conversationId = await ensureActiveConversation(content);
    if (!conversationId) {
      return;
    }
    const tempId = -Date.now();
    const tempMessage: ProjectChatMessage = {
      id: tempId,
      conversationId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      kind: "message"
    };
    pendingUserMessagesRef.current.push({ tempId, content, conversationId });
    setMessages((prev: ProjectChatMessage[]) => [...prev, tempMessage]);
    setIsSending(true);
    setMessage(null);
    setInput("");
    try {
      const res = await apiPost<{
        userMessage: ProjectChatMessage;
        assistantMessage: ProjectChatMessage;
      }>(`/api/projects/${project}/chat`, {
        role: "user",
        content,
        mode,
        conversationId
      });
      setMessages((prev: ProjectChatMessage[]) => {
        const withUser = replaceTempMessage(prev, tempId, res.userMessage);
        if (sseConnected) {
          return withUser;
        }
        return upsertMessages(withUser, [res.assistantMessage]);
      });
      pendingUserMessagesRef.current = pendingUserMessagesRef.current.filter(
        (entry: PendingUserMessage) => entry.tempId !== tempId
      );
      loadConversations(conversationId);
    } catch {
      setMessage("Chat request failed. Check API key.");
      setMessages((prev: ProjectChatMessage[]) => prev.filter((msg) => msg.id !== tempId));
      setInput(content);
      pendingUserMessagesRef.current = pendingUserMessagesRef.current.filter(
        (entry: PendingUserMessage) => entry.tempId !== tempId
      );
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

  const sidebarContent = (
    <>
      <div className="project-chat-sidebar-header">
        <div>
          <div className="project-chat-sidebar-label">Conversations</div>
          <div className="project-chat-sidebar-subtitle">Most recent first</div>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            const conversationId = await createConversation("Conversation");
            if (conversationId) {
              loadConversations(conversationId);
            }
          }}
        >
          New
        </Button>
      </div>
      <div className="project-chat-list">
        {conversations.length === 0 ? (
          <p className="muted">No conversations yet.</p>
        ) : (
          conversations.map((conv) => {
            const metaSource = conv.lastMessageAt ?? conv.createdAt;
            const meta = metaSource ? new Date(metaSource).toLocaleString() : "";
            return (
              <button
                key={conv.id}
                type="button"
                title={conv.title}
                className={`project-chat-list-item${
                  conv.id === activeConversationId ? " is-active" : ""
                }`}
                onClick={() => selectConversation(conv.id)}
              >
                <div className="project-chat-list-title">{conv.title}</div>
                {meta ? <div className="project-chat-list-meta">{meta}</div> : null}
              </button>
            );
          })
        )}
      </div>
    </>
  );

  return (
    <section className="project-chat-shell">
      <div className="project-chat-header">
        <div>
          <h1 className="app-heading">Project chat</h1>
          <p className="project-chat-project">Project: {project}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="project-chat-sidebar-toggle"
          onClick={() => setIsSidebarOpen(true)}
        >
          Conversations
        </Button>
      </div>

      <div className="project-chat-content">
        <div className="project-chat-layout">
          <aside className="project-chat-sidebar">{sidebarContent}</aside>

          <div className="discovery-chat project-chat">
            <div className="chat-scroll" ref={scrollRef} onScroll={handleScroll}>
              {!activeConversationId ? (
                <p className="muted">Select a conversation or start a new one.</p>
              ) : isLoadingMessages ? (
                <p className="muted">Loading conversation...</p>
              ) : messages.length === 0 ? (
                <p className="muted">No messages yet.</p>
              ) : null}
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
        </div>
      </div>

      {isSidebarOpen ? (
        <div
          className="project-chat-backdrop is-open"
          onClick={() => setIsSidebarOpen(false)}
        />
      ) : null}
      <aside
        className={`project-chat-sidebar-flyout${isSidebarOpen ? " is-open" : ""}`}
      >
        {sidebarContent}
      </aside>
    </section>
  );
}
