import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api/client.js";
import type { TaskDoneListResponse } from "@shared/types";

export default function DoneTasksPage() {
  const { project: projectParam } = useParams<{ project: string }>();
  const project = projectParam ?? "";
  const [tasks, setTasks] = useState<TaskDoneListResponse["tasks"]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!project) {
      setTasks([]);
      return;
    }
    setIsLoading(true);
    apiGet<TaskDoneListResponse>(`/api/projects/${encodeURIComponent(project)}/tasks/done`)
      .then((response) => setTasks(response.tasks))
      .catch(() => setTasks([]))
      .finally(() => setIsLoading(false));
  }, [project]);

  if (!project) {
    return (
      <section>
        <h1>Done tasks</h1>
        <p>Open a project to view done tasks.</p>
      </section>
    );
  }

  return (
    <section className="done-tasks-page">
      <div className="done-tasks-header">
        <div>
          <h1>Done tasks</h1>
          <p className="muted">Project: {project}</p>
        </div>
        <Link to={`/projects/${encodeURIComponent(project)}/tasks`} className="primary-link">
          Back to board
        </Link>
      </div>

      {isLoading ? <p className="muted">Loading done tasks...</p> : null}
      {!isLoading && tasks.length === 0 ? <p className="muted">No done tasks yet.</p> : null}

      <div className="done-task-list">
        {tasks.map((task) => (
          <Link
            key={task.id}
            to={`/projects/${encodeURIComponent(project)}/tasks/${task.id}`}
            className="task-card task-card-link"
          >
            <strong>{task.title}</strong>
            <span className="muted">
              Done {new Date(task.doneAt ?? task.updatedAt).toLocaleString()}
            </span>
            {task.subtaskCount > 0 ? <span>{task.subtaskCount} subtasks</span> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}
