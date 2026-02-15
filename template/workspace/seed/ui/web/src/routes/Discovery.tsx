import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/client.js";
import Button from "../components/Button.js";
import ChatBubble from "../components/ChatBubble.js";
import type {
  CreateProjectRequest,
  CreateProjectResponse,
  DiscoveryCompleteRequest,
  DiscoveryMessageRequest,
  DiscoveryStartResponse,
  DiscoveryMessageResponse,
  ProjectType
} from "@shared/types";

type DiscoveryMessage = {
  role: "user" | "assistant";
  content: string;
};

const defaultRecommendation: ProjectType = "nextjs";

export default function Discovery() {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [discoveryId, setDiscoveryId] = useState<number | null>(null);
  const [messages, setMessages] = useState<DiscoveryMessage[]>([]);
  const [input, setInput] = useState("");
  const [recommendedType, setRecommendedType] = useState<ProjectType>(defaultRecommendation);
  const [projectName, setProjectName] = useState("");
  const [briefText, setBriefText] = useState("");
  const [ready, setReady] = useState(false);
  const [showScaffold, setShowScaffold] = useState(false);
  const [alternatives, setAlternatives] = useState<{ type: ProjectType; why: string[] }[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    apiPost<DiscoveryStartResponse>("/api/discovery/start", {})
      .then((res) => setDiscoveryId(res.discoveryId))
      .catch(() => setDiscoveryId(null));
  }, []);

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
    if (!input.trim() || !discoveryId) {
      return;
    }
    setIsThinking(true);
    setMessage(null);
    const userMsg: DiscoveryMessage = { role: "user", content: input.trim() };
    setMessages((prev: DiscoveryMessage[]) => [...prev, userMsg]);
    setInput("");

    const body: DiscoveryMessageRequest = {
      discoveryId,
      role: "user",
      content: userMsg.content
    };
    try {
      const response = await apiPost<DiscoveryMessageResponse>(
        "/api/discovery/message",
        body
      );

      const assistantReply: DiscoveryMessage = {
        role: "assistant",
        content: response.assistantMessage
      };
      setMessages((prev: DiscoveryMessage[]) => [...prev, assistantReply]);

      if (response.status === "ready") {
        setReady(true);
        setRecommendedType(response.recommendation.recommended);
        setAlternatives(response.recommendation.alternatives ?? []);
        if (response.draftBrief) {
          setBriefText(response.draftBrief);
        }
        if (response.suggestedName) {
          setProjectName(response.suggestedName);
        }
      } else {
        setReady(false);
      }
      setIsThinking(false);
    } catch {
      setIsThinking(false);
      setMessage("Discovery request failed. Check API key.");
    }
  };

  const completeDiscovery = async () => {
    if (!discoveryId) {
      return;
    }
    const payload: DiscoveryCompleteRequest = {
      discoveryId,
      summary: briefText.slice(0, 200) || undefined,
      recommendedType: recommendedType,
      alternatives: alternatives,
      draftBrief: briefText,
      suggestedName: projectName
    };
    await apiPost("/api/discovery/complete", payload);
  };

  const scaffoldProject = async () => {
    if (!projectName) {
      setMessage("Enter a project name.");
      return;
    }
    setIsCreating(true);
    await completeDiscovery();

    const payload: CreateProjectRequest = {
      name: projectName,
      type: recommendedType,
      initMode: "discussed",
      toolPreference: "bun",
      brief: briefText
    };

    try {
      const response = await apiPost<CreateProjectResponse>(
        "/api/projects/create",
        payload
      );
      const createdName = response.project?.name;
      if (!createdName || !discoveryId) {
        setMessage("Project creation failed.");
        setIsCreating(false);
        return;
      }

      const transcript = await apiGet<{ messages: { role: string; content: string }[] }>(
        `/api/discovery/${discoveryId}/messages`
      );
      const transcriptText = (transcript.messages ?? [])
        .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
        .join("\n\n");
      const buildPrompt = `${transcriptText}\n\nBased on the above conversation, begin building in this directory.`;
      await apiPost(`/api/projects/${createdName}/build-prompt`, {
        prompt: buildPrompt
      });

      window.dispatchEvent(new Event("seed:projects-updated"));
      window.localStorage.setItem(`seed.chatMode.${createdName}`, "build");
      navigate(`/chat?project=${createdName}&mode=build`);
    } catch {
      setMessage("Project creation failed.");
      setIsCreating(false);
    }
  };

  return (
    <section className="discovery-shell">
      <h1>Discovery</h1>
      {!showScaffold ? (
        <div className="discovery-chat">
          <div className="chat-scroll" ref={scrollRef} onScroll={handleScroll}>
            {messages.length === 0 ? (
              <p className="muted">No messages yet.</p>
            ) : (
              messages.map((msg: DiscoveryMessage, index: number) => (
                <ChatBubble key={`${msg.role}-${index}`} role={msg.role} content={msg.content} />
              ))
            )}
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
            {isThinking ? (
              <div className="thinking-indicator">
                Contemplating your input and preparing a response...
              </div>
            ) : message ? (
              <div className="error-indicator">{message}</div>
            ) : null}
            <textarea
              rows={4}
              value={input}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setInput(event.target.value)}
              placeholder="Describe the app you want to build..."
            />
            <div className="card-actions">
              <Button type="button" onClick={sendMessage}>
                Send
              </Button>
              {ready ? (
                <Button type="button" variant="primary" onClick={() => setShowScaffold(true)}>
                  Proceed to Recommendations & Scaffolding
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="panel">
            <h2>Recommendation</h2>
            <p>Recommended scaffold is pre-selected. Override if needed.</p>
            <label>
              <input
                type="radio"
                name="projectType"
                value="nextjs"
                checked={recommendedType === "nextjs"}
                onChange={() => setRecommendedType("nextjs")}
              />
              Next.js{recommendedType === "nextjs" ? " (recommended)" : ""}
            </label>
            <label>
              <input
                type="radio"
                name="projectType"
                value="go_service"
                checked={recommendedType === "go_service"}
                onChange={() => setRecommendedType("go_service")}
              />
              Go service{recommendedType === "go_service" ? " (recommended)" : ""}
            </label>
            <label>
              <input
                type="radio"
                name="projectType"
                value="ocaml_dune"
                checked={recommendedType === "ocaml_dune"}
                onChange={() => setRecommendedType("ocaml_dune")}
              />
              OCaml (dune){recommendedType === "ocaml_dune" ? " (recommended)" : ""}
            </label>
          </div>

          <div className="panel">
            <h2>Project name</h2>
            <input
              value={projectName}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setProjectName(event.target.value)
              }
              placeholder="overwatch"
            />
          </div>

          <div className="panel">
            <h2>Project brief</h2>
            <p>This will be stored in Seed memory and written once to PROJECT_BRIEF.md.</p>
            <textarea
              rows={6}
              value={briefText}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                setBriefText(event.target.value)
              }
              placeholder="Write a concise brief..."
            />
          </div>

          <div className="panel">
            <Button type="button" onClick={scaffoldProject} disabled={isCreating}>
              {isCreating ? "Creating project..." : "Begin creation"}
            </Button>
            {isCreating ? <p className="muted">Scaffolding project...</p> : null}
          </div>
        </div>
      )}
    </section>
  );
}
