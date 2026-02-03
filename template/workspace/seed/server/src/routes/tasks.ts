import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import { recordEvent } from "../storage/events.js";
import type {
  AcceptTasksRequest,
  AcceptTasksResponse,
  SuggestedTask,
  TaskSelectionRequest,
  TaskSelectionResponse
} from "@shared/types";

type RouteContext = {
  workspaceDir: string;
  db: Database.Database;
};

function insertTask(
  db: Database.Database,
  projectId: number,
  task: SuggestedTask,
  parentTaskId?: number
) {
  const stmt = db.prepare(
    "INSERT INTO tasks (project_id, parent_task_id, title, status, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const info = stmt.run(
    projectId,
    parentTaskId ?? null,
    task.title,
    "backlog",
    new Date().toISOString()
  );
  const newId = Number(info.lastInsertRowid);

  if (task.subtasks && task.subtasks.length > 0) {
    for (const subtask of task.subtasks) {
      insertTask(db, projectId, subtask, newId);
    }
  }
}

export function registerTaskRoutes(
  server: FastifyInstance,
  context: RouteContext
) {
  server.get(
    "/api/projects/:name/tasks",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      if (!name) {
        return reply.status(400).send({ error: "Missing project name" });
      }

      const project = context.db
        .prepare("SELECT id FROM projects WHERE name = ?")
        .get(name) as { id: number } | undefined;

      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const rows = context.db
        .prepare(
          "SELECT id, parent_task_id, title, status, created_at FROM tasks WHERE project_id = ?"
        )
        .all(project.id) as {
        id: number;
        parent_task_id: number | null;
        title: string;
        status: string;
        created_at: string;
      }[];

      const byId = new Map<number, { id: number; title: string; status: string; subtasks: unknown[] }>();
      rows.forEach((row) => {
        byId.set(row.id, {
          id: row.id,
          title: row.title,
          status: row.status,
          subtasks: []
        });
      });

      const roots: { id: number; title: string; status: string; subtasks: unknown[] }[] = [];
      rows.forEach((row) => {
        const task = byId.get(row.id);
        if (!task) {
          return;
        }
        if (row.parent_task_id) {
          const parent = byId.get(row.parent_task_id);
          if (parent) {
            parent.subtasks.push(task);
          }
        } else {
          roots.push(task);
        }
      });

      const grouped = {
        backlog: roots.filter((task) => task.status === "backlog"),
        active: roots.filter((task) => task.status === "active"),
        done: roots.filter((task) => task.status === "done")
      };

      return grouped;
    }
  );
  server.post(
    "/api/tasks/accept",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as AcceptTasksRequest;
      if (!body?.projectName || !body?.tasks) {
        return reply.status(400).send({ ok: false, error: "Missing projectName or tasks" });
      }

      const project = context.db
        .prepare("SELECT id FROM projects WHERE name = ?")
        .get(body.projectName) as { id: number } | undefined;

      if (!project) {
        return reply.status(404).send({ ok: false, error: "Project not found" });
      }

      for (const task of body.tasks) {
        insertTask(context.db, project.id, task);
      }

      recordEvent(context.db, "tasks.accepted", { count: body.tasks.length }, project.id);

      const response: AcceptTasksResponse = { ok: true };
      return response;
    }
  );

  server.post(
    "/api/tasks/from-selection",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as TaskSelectionRequest;
      if (
        body?.messageId === undefined ||
        body?.start === undefined ||
        body?.end === undefined
      ) {
        return reply.status(400).send({ ok: false, error: "Missing selection data" });
      }

      const msg = context.db
        .prepare("SELECT id, project_id, role, content FROM messages WHERE id = ?")
        .get(body.messageId) as
        | { id: number; project_id: number; role: string; content: string }
        | undefined;

      if (!msg) {
        return reply.status(404).send({ ok: false, error: "Message not found" });
      }

      if (msg.role !== "assistant") {
        return reply.status(400).send({ ok: false, error: "Selection must be from assistant" });
      }

      const start = Math.max(0, body.start);
      const end = Math.min(msg.content.length, body.end);
      if (end <= start) {
        return reply.status(400).send({ ok: false, error: "Invalid selection range" });
      }

      const snippet = msg.content.slice(start, end);
      const taskStmt = context.db.prepare(
        "INSERT INTO tasks (project_id, parent_task_id, title, status, created_at) VALUES (?, ?, ?, ?, ?)"
      );
      const taskInfo = taskStmt.run(
        msg.project_id,
        null,
        snippet,
        "backlog",
        new Date().toISOString()
      );

      const taskId = Number(taskInfo.lastInsertRowid);
      const selStmt = context.db.prepare(
        "INSERT INTO task_selections (message_id, task_id, start_offset, end_offset, snippet) VALUES (?, ?, ?, ?, ?)"
      );
      selStmt.run(msg.id, taskId, start, end, snippet);

      recordEvent(context.db, "task.from_selection", { taskId, messageId: msg.id }, msg.project_id);

      const response: TaskSelectionResponse = { ok: true, taskId };
      return response;
    }
  );
}
