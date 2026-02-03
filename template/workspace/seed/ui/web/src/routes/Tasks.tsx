import { useEffect, useState, type ChangeEvent } from "react";
import { apiGet } from "../api/client.js";

type Task = {
  id: number;
  title: string;
  status: string;
  subtasks: Task[];
};

type ProjectSummary = { name: string };

type TaskGroups = {
  backlog: Task[];
  active: Task[];
  done: Task[];
};

export default function Tasks() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [groups, setGroups] = useState<TaskGroups>({ backlog: [], active: [], done: [] });

  useEffect(() => {
    apiGet<{ projects: ProjectSummary[] }>("/api/onboarding/state")
      .then((data) => setProjects(data.projects ?? []))
      .catch(() => setProjects([]));
  }, []);

  const loadTasks = async (projectName: string) => {
    if (!projectName) {
      return;
    }
    try {
      const data = await apiGet<TaskGroups>(`/api/projects/${projectName}/tasks`);
      setGroups(data);
    } catch {
      setGroups({ backlog: [], active: [], done: [] });
    }
  };

  return (
    <section>
      <h1>Tasks</h1>
      <div className="panel">
        <label>
          Project
          <select
            value={selectedProject}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              const value = event.target.value;
              setSelectedProject(value);
              loadTasks(value);
            }}
          >
            <option value="">Select a project</option>
            {projects.map((project: ProjectSummary) => (
              <option key={project.name} value={project.name}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="task-board">
        <div className="task-column">
          <h2>Backlog</h2>
          {groups.backlog.map((task) => (
            <div key={task.id} className="task-card">
              <strong>{task.title}</strong>
              {task.subtasks.length ? (
                <span>{task.subtasks.length} subtasks</span>
              ) : null}
            </div>
          ))}
        </div>
        <div className="task-column">
          <h2>Active</h2>
          {groups.active.map((task) => (
            <div key={task.id} className="task-card">
              <strong>{task.title}</strong>
              {task.subtasks.length ? (
                <span>{task.subtasks.length} subtasks</span>
              ) : null}
            </div>
          ))}
        </div>
        <div className="task-column">
          <h2>Done</h2>
          {groups.done.map((task) => (
            <div key={task.id} className="task-card">
              <strong>{task.title}</strong>
              {task.subtasks.length ? (
                <span>{task.subtasks.length} subtasks</span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
