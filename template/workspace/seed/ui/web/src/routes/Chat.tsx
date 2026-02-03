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

type Message = {
  id: number;
  role: "assistant" | "user";
  content: string;
  selections?: Selection[];
};

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [assistantText, setAssistantText] = useState("");
  const [activeSelection, setActiveSelection] = useState<Selection | null>(null);
  const [selections, setSelections] = useState<Selection[]>([]);
  const containerRefs = useRef<Record<number, HTMLDivElement | null>>({});

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
    apiGet<{ messages: Message[] }>(`/api/projects/${project}/messages`)
      .then((res) => {
        setMessages(res.messages ?? []);
        const loaded: Selection[] = [];
        (res.messages ?? []).forEach((msg) => {
          (msg.selections ?? []).forEach((sel) => {
            loaded.push({ messageId: msg.id, start: sel.start, end: sel.end });
          });
        });
        setSelections(loaded);
      })
      .catch(() => setMessages([]));
  }, [project]);

  const addAssistantMessage = async () => {
    if (!assistantText.trim() || !project) {
      return;
    }
    const res = await apiPost<{ id: number }>(`/api/projects/${project}/messages`, {
      role: "assistant",
      content: assistantText.trim()
    });
    setMessages((prev: Message[]) => [
      ...prev,
      { id: res.id, role: "assistant", content: assistantText.trim() }
    ]);
    setAssistantText("");
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
    <section>
      <h1>Project chat</h1>
      <p>Project: {project}</p>

      <div className="panel">
        <h2>Assistant messages</h2>
        {messages.length === 0 ? <p>No messages yet.</p> : null}
        {messages
          .filter((msg) => msg.role === "assistant")
          .map((msg) => (
            <div
              key={msg.id}
              className="chat-message"
              ref={(el) => {
                containerRefs.current[msg.id] = el;
              }}
              onMouseUp={() => captureSelection(msg.id)}
            >
              {renderWithHighlights(msg.content, selectionByMessage.get(msg.id) ?? [])}
            </div>
          ))}
        {activeSelection ? (
          <button type="button" onClick={createTaskFromSelection}>
            Create task from selection
          </button>
        ) : null}
      </div>

      <div className="panel">
        <h2>Add assistant message</h2>
        <textarea
          rows={4}
          value={assistantText}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
            setAssistantText(event.target.value)
          }
          placeholder="Paste a response you want to capture tasks from..."
        />
        <button type="button" onClick={addAssistantMessage}>
          Add assistant message
        </button>
      </div>
    </section>
  );
}
