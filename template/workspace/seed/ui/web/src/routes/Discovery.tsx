import { useEffect, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../api/client.js";
import type {
  CreateProjectRequest,
  CreateProjectResponse,
  DiscoveryCompleteRequest,
  DiscoveryMessageRequest,
  DiscoveryStartResponse,
  DiscoveryMessageResponse,
  ProjectType
} from "@shared/types";
import TaskSuggestionsEditor from "../components/TaskSuggestionsEditor.js";

type DiscoveryMessage = {
  role: "user" | "assistant";
  content: string;
};

const defaultRecommendation: ProjectType = "nextjs";

export default function Discovery() {
  const navigate = useNavigate();
  const [discoveryId, setDiscoveryId] = useState<number | null>(null);
  const [messages, setMessages] = useState<DiscoveryMessage[]>([]);
  const [input, setInput] = useState("");
  const [recommendedType, setRecommendedType] = useState<ProjectType>(defaultRecommendation);
  const [projectName, setProjectName] = useState("");
  const [briefText, setBriefText] = useState("");
  const [ready, setReady] = useState(false);
  const [alternatives, setAlternatives] = useState<{ type: ProjectType; why: string[] }[]>([]);
  const [suggestedTasks, setSuggestedTasks] = useState<CreateProjectResponse["suggestedTasks"] | null>(null);
  const [createdProject, setCreatedProject] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    apiPost<DiscoveryStartResponse>("/api/discovery/start", {})
      .then((res) => setDiscoveryId(res.discoveryId))
      .catch(() => setDiscoveryId(null));
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || !discoveryId) {
      return;
    }
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
      }
    } catch {
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
      setCreatedProject(response.project?.name ?? null);
      setSuggestedTasks(response.suggestedTasks ?? []);
      setMessage("Project created. Review suggested tasks.");
    } catch {
      setMessage("Project creation failed.");
    }
  };

  const acceptTasks = async () => {
    if (!createdProject || !suggestedTasks) {
      return;
    }
    await apiPost("/api/tasks/accept", {
      projectName: createdProject,
      tasks: suggestedTasks
    });
    navigate(`/chat?project=${createdProject}`);
  };

  return (
    <section>
      <h1>Discovery</h1>
      {message ? <p>{message}</p> : null}

      {!ready ? (
        <div>
          <div className="panel">
            <h2>Describe your project</h2>
            <textarea
              rows={6}
              value={input}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setInput(event.target.value)}
              placeholder="Describe the app you want to build..."
            />
            <button type="button" onClick={sendMessage}>
              Send
            </button>
          </div>

          <div className="panel">
            <h2>Discovery transcript</h2>
            {messages.length === 0 ? <p>No messages yet.</p> : null}
            {messages.map((msg, index) => (
              <div key={`${msg.role}-${index}`}>
                <strong>{msg.role}</strong>: {msg.content}
              </div>
            ))}
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
              Next.js (recommended)
            </label>
            <label>
              <input
                type="radio"
                name="projectType"
                value="go_service"
                checked={recommendedType === "go_service"}
                onChange={() => setRecommendedType("go_service")}
              />
              Go service
            </label>
            <label>
              <input
                type="radio"
                name="projectType"
                value="ocaml_dune"
                checked={recommendedType === "ocaml_dune"}
                onChange={() => setRecommendedType("ocaml_dune")}
              />
              OCaml (dune)
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
            <button type="button" onClick={scaffoldProject}>
              Scaffold project
            </button>
          </div>
        </div>
      )}

      {suggestedTasks ? (
        <TaskSuggestionsEditor
          tasks={suggestedTasks}
          onChange={setSuggestedTasks}
          onAccept={acceptTasks}
        />
      ) : null}
    </section>
  );
}
