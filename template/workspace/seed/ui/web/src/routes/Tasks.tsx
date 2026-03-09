import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiGet } from "../api/client.js";

type Task = {
  id: number;
  title: string;
  status: string;
  subtasks: Task[];
};

type TaskGroups = {
  backlog: Task[];
  active: Task[];
  done: Task[];
};

export default function Tasks() {
  const { project: projectParam } = useParams<{ project: string }>();
  const project = projectParam ?? "";
  const [groups, setGroups] = useState<TaskGroups>({ backlog: [], active: [], done: [] });

  useEffect(() => {
    if (!project) {
      setGroups({ backlog: [], active: [], done: [] });
      return;
    }
    apiGet<TaskGroups>(`/api/projects/${encodeURIComponent(project)}/tasks`)
      .then((data) => setGroups(data))
      .catch(() => setGroups({ backlog: [], active: [], done: [] }));
  }, [project]);

  if (!project) {
    return (
      <section>
        <h1>Tasks</h1>
        <p>Open a project to view tasks.</p>
      </section>
    );
  }

  return (
    <section>
      <h1>Tasks</h1>
      <p className="muted">Project: {project}</p>

      <div className="task-board">
        <div className="task-column">
          <h2>Backlog</h2>
          {groups.backlog.map((task: Task) => (
            <div key={task.id} className="task-card">
              <strong>{task.title}</strong>
              {task.subtasks.length ? <span>{task.subtasks.length} subtasks</span> : null}
            </div>
          ))}
        </div>
        <div className="task-column">
          <h2>Active</h2>
          {groups.active.map((task: Task) => (
            <div key={task.id} className="task-card">
              <strong>{task.title}</strong>
              {task.subtasks.length ? <span>{task.subtasks.length} subtasks</span> : null}
            </div>
          ))}
        </div>
        <div className="task-column">
          <h2>Done</h2>
          {groups.done.map((task: Task) => (
            <div key={task.id} className="task-card">
              <strong>{task.title}</strong>
              {task.subtasks.length ? <span>{task.subtasks.length} subtasks</span> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
