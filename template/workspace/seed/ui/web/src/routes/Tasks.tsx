import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api/client.js";
import type { TaskBoardItem, TaskBoardResponse } from "@shared/types";

const emptyBoard: TaskBoardResponse = {
  todo: [],
  inProgress: [],
  inReview: [],
  done: []
};

type TaskColumnProps = {
  title: string;
  tasks: TaskBoardItem[];
  project: string;
  footer?: ReactNode;
};

function TaskColumn({ title, tasks, project, footer }: TaskColumnProps) {
  return (
    <div className="task-column">
      <h2>{title}</h2>
      <div className="task-column-list">
        {tasks.length === 0 ? <p className="muted">No tasks.</p> : null}
        {tasks.map((task) => (
          <Link
            key={task.id}
            to={`/projects/${encodeURIComponent(project)}/tasks/${task.id}`}
            className="task-card task-card-link"
          >
            <strong>{task.title}</strong>
            <span className="muted">{new Date(task.updatedAt).toLocaleString()}</span>
            {task.subtaskCount > 0 ? <span>{task.subtaskCount} subtasks</span> : null}
          </Link>
        ))}
      </div>
      {footer ? <div className="task-column-footer">{footer}</div> : null}
    </div>
  );
}

export default function Tasks() {
  const { project: projectParam } = useParams<{ project: string }>();
  const project = projectParam ?? "";
  const [groups, setGroups] = useState<TaskBoardResponse>(emptyBoard);

  useEffect(() => {
    if (!project) {
      setGroups(emptyBoard);
      return;
    }
    apiGet<TaskBoardResponse>(`/api/projects/${encodeURIComponent(project)}/tasks`)
      .then((data) => setGroups(data))
      .catch(() => setGroups(emptyBoard));
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
        <TaskColumn title="To Do" tasks={groups.todo} project={project} />
        <TaskColumn title="In Progress" tasks={groups.inProgress} project={project} />
        <TaskColumn title="In Review" tasks={groups.inReview} project={project} />
        <TaskColumn
          title="Done"
          tasks={groups.done}
          project={project}
          footer={
            <Link to={`/projects/${encodeURIComponent(project)}/tasks/done`} className="primary-link">
              View all done tasks
            </Link>
          }
        />
      </div>
    </section>
  );
}
