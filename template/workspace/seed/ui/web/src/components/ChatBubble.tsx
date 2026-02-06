import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";

type ChatBubbleProps = {
  role?: "user" | "assistant";
  kind?: "message" | "tool";
  status?: "running" | "done" | "error";
  toolName?: string;
  toolMeta?: string;
  content?: string;
  className?: string;
  children?: ReactNode;
};

export default function ChatBubble({
  role = "assistant",
  kind = "message",
  status,
  toolName,
  toolMeta,
  content = "",
  className,
  children
}: ChatBubbleProps) {
  const classes = [
    "chat-bubble",
    role === "user" ? "chat-bubble-user" : "",
    kind === "tool" ? "chat-bubble-tool" : "",
    kind === "tool" && status === "error" ? "chat-bubble-tool-error" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  const statusIcon =
    kind === "tool" ? (
      status === "done" ? (
        <svg className="chat-bubble-status-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M5 13l4 4L19 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : status === "error" ? (
        <svg className="chat-bubble-status-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 7v6m0 4h.01"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <span className="chat-bubble-status-ellipsis">...</span>
      )
    ) : null;

  const statusClass = status === "error" ? "is-error" : status === "done" ? "is-done" : "";

  const toolLabel = [toolName ?? "tool", toolMeta ?? ""].filter(Boolean).join(" ");

  const header = kind === "tool" ? (
    <div className="chat-bubble-header">Tool</div>
  ) : (
    <div className="chat-bubble-header">{role === "user" ? "User" : "Assistant"}</div>
  );

  return (
    <div className={classes}>
      {header}
      <div className="chat-bubble-content">
        {kind === "tool" ? (
          <div className="chat-bubble-tool-row">
            <span className="chat-bubble-tool-label">{toolLabel}</span>
            <span className={`chat-bubble-status ${statusClass}`}>{statusIcon}</span>
          </div>
        ) : children ? (
          children
        ) : (
          <ReactMarkdown>{content}</ReactMarkdown>
        )}
      </div>
    </div>
  );
}
