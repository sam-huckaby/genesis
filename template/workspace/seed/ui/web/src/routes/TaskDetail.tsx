import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiPut } from "../api/client.js";
import type {
  TaskDetail,
  TaskDetailResponse,
  TaskStatus,
  UpdateTaskRequest,
  UpdateTaskResponse
} from "@shared/types";

const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "in_review", label: "In Review" },
  { value: "done", label: "Done" }
];

export default function TaskDetailPage() {
  const { project: projectParam, taskId: taskIdParam } = useParams<{ project: string; taskId: string }>();
  const project = projectParam ?? "";
  const taskId = Number(taskIdParam ?? "");
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!project || !Number.isFinite(taskId)) {
      setTask(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    apiGet<TaskDetailResponse>(`/api/projects/${encodeURIComponent(project)}/tasks/${taskId}`)
      .then((response) => {
        setTask(response.task ?? null);
        setTitle(response.task?.title ?? "");
        setContext(response.task?.context ?? "");
        setStatus(response.task?.status ?? "todo");
      })
      .catch(() => {
        setTask(null);
        setError("Failed to load task.");
      })
      .finally(() => setIsLoading(false));
  }, [project, taskId]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!project || !task) {
      return;
    }
    setIsSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const payload: UpdateTaskRequest = {
        title,
        context,
        status
      };
      const response = await apiPut<UpdateTaskResponse>(
        `/api/projects/${encodeURIComponent(project)}/tasks/${task.id}`,
        payload
      );
      setTask(response.task);
      setTitle(response.task.title);
      setContext(response.task.context);
      setStatus(response.task.status);
      setSavedAt(new Date().toLocaleTimeString());
    } catch {
      setError("Failed to save task changes.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!project || !Number.isFinite(taskId)) {
    return (
      <section>
        <h1>Task detail</h1>
        <p>Open a project task to view details.</p>
      </section>
    );
  }

  return (
    <section className="task-detail-page">
      <div className="task-detail-header">
        <div>
          <h1>Task detail</h1>
          <p className="muted">Project: {project}</p>
        </div>
        <Link to={`/projects/${encodeURIComponent(project)}/tasks`} className="primary-link">
          Back to board
        </Link>
      </div>

      {isLoading ? <p className="muted">Loading task...</p> : null}
      {error ? <p className="error-indicator">{error}</p> : null}
      {!isLoading && !error && !task ? <p className="muted">Task not found.</p> : null}

      {task ? (
        <form className="task-detail-form panel" onSubmit={onSubmit}>
          <label>
            Title
            <input
              value={title}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Context
            <textarea
              rows={10}
              value={context}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setContext(event.target.value)}
            />
          </label>
          <label>
            Status
            <select
              value={status}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setStatus(event.target.value as TaskStatus)
              }
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {task.selection ? (
            <div className="task-detail-meta">
              <h2>Selection</h2>
              <p className="muted">
                Message {task.selection.messageId} ({task.selection.start}-{task.selection.end})
              </p>
              <p className="brief-text">{task.selection.snippet}</p>
            </div>
          ) : null}

          <div className="task-detail-meta">
            <h2>Future subagent workspace</h2>
            <p className="muted">
              This section is reserved for subagent tools and workflows and will be added in a later update.
            </p>
          </div>

          <div className="task-actions">
            <button type="submit" className="btn btn-primary" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save task"}
            </button>
            {savedAt ? <span className="muted">Saved at {savedAt}</span> : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
