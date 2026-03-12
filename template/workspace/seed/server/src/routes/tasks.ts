import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import { recordEvent } from "../storage/events.js";
import { unlockProjectNavFeature } from "../util/nav_unlocks.js";
import type {
  AcceptTasksRequest,
  AcceptTasksResponse,
  SuggestedTask,
  TaskBoardItem,
  TaskBoardResponse,
  TaskDetail,
  TaskDetailResponse,
  TaskDoneListResponse,
  TaskSelectionContext,
  TaskSelectionRequest,
  TaskSelectionResponse,
  TaskStatus,
  UpdateTaskRequest,
  UpdateTaskResponse
} from "@shared/types";

type RouteContext = {
  workspaceDir: string;
  db: Database.Database;
};

type TaskRow = {
  id: number;
  project_id: number;
  parent_task_id: number | null;
  title: string;
  context: string;
  status: string;
  created_at: string;
  updated_at: string;
  done_at: string | null;
};

function normalizeTaskStatus(input: string): TaskStatus {
  if (input === "todo" || input === "in_progress" || input === "in_review" || input === "done") {
    return input;
  }
  if (input === "backlog") {
    return "todo";
  }
  if (input === "active") {
    return "in_progress";
  }
  return "todo";
}

function isTaskStatus(input: unknown): input is TaskStatus {
  return input === "todo" || input === "in_progress" || input === "in_review" || input === "done";
}

function mapTaskBoardItem(row: {
  id: number;
  title: string;
  status: string;
  updated_at: string;
  done_at: string | null;
  subtask_count: number;
}): TaskBoardItem {
  return {
    id: row.id,
    title: row.title,
    status: normalizeTaskStatus(row.status),
    subtaskCount: row.subtask_count,
    updatedAt: row.updated_at,
    doneAt: row.done_at
  };
}

function getProjectId(db: Database.Database, name: string): number | null {
  const project = db.prepare("SELECT id FROM projects WHERE name = ?").get(name) as
    | { id: number }
    | undefined;
  return project?.id ?? null;
}

function getTaskSelectionContext(db: Database.Database, taskId: number): TaskSelectionContext | null {
  const selection = db
    .prepare(
      "SELECT message_id, start_offset, end_offset, snippet FROM task_selections WHERE task_id = ? ORDER BY id DESC LIMIT 1"
    )
    .get(taskId) as
    | {
        message_id: number;
        start_offset: number;
        end_offset: number;
        snippet: string;
      }
    | undefined;
  if (!selection) {
    return null;
  }
  return {
    messageId: selection.message_id,
    start: selection.start_offset,
    end: selection.end_offset,
    snippet: selection.snippet
  };
}

function mapTaskDetail(task: TaskRow, selection: TaskSelectionContext | null): TaskDetail {
  return {
    id: task.id,
    projectId: task.project_id,
    parentTaskId: task.parent_task_id,
    title: task.title,
    context: task.context,
    status: normalizeTaskStatus(task.status),
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    doneAt: task.done_at,
    selection
  };
}

function insertTask(
  db: Database.Database,
  projectId: number,
  task: SuggestedTask,
  parentTaskId?: number
) {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO tasks (project_id, parent_task_id, title, context, status, created_at, updated_at, done_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const info = stmt.run(
    projectId,
    parentTaskId ?? null,
    task.title,
    task.description ?? "",
    "todo",
    now,
    now,
    null
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

      const projectId = getProjectId(context.db, name);
      if (!projectId) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const rows = context.db
        .prepare(
          "SELECT t.id, t.title, t.status, t.updated_at, t.done_at, COUNT(c.id) AS subtask_count FROM tasks t LEFT JOIN tasks c ON c.parent_task_id = t.id WHERE t.project_id = ? AND t.parent_task_id IS NULL GROUP BY t.id, t.title, t.status, t.updated_at, t.done_at"
        )
        .all(projectId) as {
        id: number;
        title: string;
        status: string;
        updated_at: string;
        done_at: string | null;
        subtask_count: number;
      }[];

      const grouped: TaskBoardResponse = {
        todo: [],
        inProgress: [],
        inReview: [],
        done: []
      };

      rows
        .map(mapTaskBoardItem)
        .forEach((task) => {
          if (task.status === "todo") {
            grouped.todo.push(task);
            return;
          }
          if (task.status === "in_progress") {
            grouped.inProgress.push(task);
            return;
          }
          if (task.status === "in_review") {
            grouped.inReview.push(task);
            return;
          }
          grouped.done.push(task);
        });

      grouped.todo.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      grouped.inProgress.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      grouped.inReview.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      grouped.done.sort((a, b) => {
        const aDone = a.doneAt ?? "";
        const bDone = b.doneAt ?? "";
        if (aDone !== bDone) {
          return bDone.localeCompare(aDone);
        }
        return b.updatedAt.localeCompare(a.updatedAt);
      });
      grouped.done = grouped.done.slice(0, 10);

      return grouped;
    }
  );

  server.get(
    "/api/projects/:name/tasks/done",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      if (!name) {
        return reply.status(400).send({ error: "Missing project name" });
      }

      const projectId = getProjectId(context.db, name);
      if (!projectId) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const rows = context.db
        .prepare(
          "SELECT t.id, t.title, t.status, t.updated_at, t.done_at, COUNT(c.id) AS subtask_count FROM tasks t LEFT JOIN tasks c ON c.parent_task_id = t.id WHERE t.project_id = ? AND t.parent_task_id IS NULL AND t.status = 'done' GROUP BY t.id, t.title, t.status, t.updated_at, t.done_at ORDER BY COALESCE(t.done_at, t.updated_at, t.created_at) DESC"
        )
        .all(projectId) as {
        id: number;
        title: string;
        status: string;
        updated_at: string;
        done_at: string | null;
        subtask_count: number;
      }[];

      const response: TaskDoneListResponse = {
        tasks: rows.map(mapTaskBoardItem)
      };

      return response;
    }
  );

  server.get(
    "/api/projects/:name/tasks/:taskId",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      const taskId = Number((request.params as { taskId?: string }).taskId);
      if (!name || !Number.isFinite(taskId)) {
        return reply.status(400).send({ error: "Missing project name or task id" });
      }

      const projectId = getProjectId(context.db, name);
      if (!projectId) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const task = context.db
        .prepare(
          "SELECT id, project_id, parent_task_id, title, context, status, created_at, updated_at, done_at FROM tasks WHERE id = ? AND project_id = ?"
        )
        .get(taskId, projectId) as TaskRow | undefined;

      const response: TaskDetailResponse = {
        task: task ? mapTaskDetail(task, getTaskSelectionContext(context.db, task.id)) : null
      };
      return response;
    }
  );

  server.put(
    "/api/projects/:name/tasks/:taskId",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      const taskId = Number((request.params as { taskId?: string }).taskId);
      const body = request.body as UpdateTaskRequest;
      if (!name || !Number.isFinite(taskId)) {
        return reply.status(400).send({ error: "Missing project name or task id" });
      }

      if (body?.status !== undefined && !isTaskStatus(body.status)) {
        return reply.status(400).send({ error: "Invalid status" });
      }

      const projectId = getProjectId(context.db, name);
      if (!projectId) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const existing = context.db
        .prepare(
          "SELECT id, project_id, parent_task_id, title, context, status, created_at, updated_at, done_at FROM tasks WHERE id = ? AND project_id = ?"
        )
        .get(taskId, projectId) as TaskRow | undefined;

      if (!existing) {
        return reply.status(404).send({ error: "Task not found" });
      }

      const nextTitle = body.title !== undefined ? body.title.trim() : existing.title;
      const nextContext = body.context !== undefined ? body.context : existing.context;
      const nextStatus = body.status !== undefined ? body.status : normalizeTaskStatus(existing.status);

      if (!nextTitle) {
        return reply.status(400).send({ error: "Task title cannot be empty" });
      }

      const now = new Date().toISOString();
      const existingStatus = normalizeTaskStatus(existing.status);
      const nextDoneAt =
        nextStatus === "done"
          ? existingStatus === "done"
            ? existing.done_at ?? now
            : now
          : null;

      context.db
        .prepare(
          "UPDATE tasks SET title = ?, context = ?, status = ?, updated_at = ?, done_at = ? WHERE id = ? AND project_id = ?"
        )
        .run(nextTitle, nextContext, nextStatus, now, nextDoneAt, taskId, projectId);

      const updated = context.db
        .prepare(
          "SELECT id, project_id, parent_task_id, title, context, status, created_at, updated_at, done_at FROM tasks WHERE id = ? AND project_id = ?"
        )
        .get(taskId, projectId) as TaskRow | undefined;

      if (!updated) {
        return reply.status(500).send({ error: "Task update failed" });
      }

      const response: UpdateTaskResponse = {
        ok: true,
        task: mapTaskDetail(updated, getTaskSelectionContext(context.db, updated.id))
      };
      return response;
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

      unlockProjectNavFeature(context.db, body.projectName, "tasks");

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
        "INSERT INTO tasks (project_id, parent_task_id, title, context, status, created_at, updated_at, done_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
      const now = new Date().toISOString();
      const taskInfo = taskStmt.run(
        msg.project_id,
        null,
        snippet,
        msg.content,
        "todo",
        now,
        now,
        null
      );

      const taskId = Number(taskInfo.lastInsertRowid);
      const selStmt = context.db.prepare(
        "INSERT INTO task_selections (message_id, task_id, start_offset, end_offset, snippet) VALUES (?, ?, ?, ?, ?)"
      );
      selStmt.run(msg.id, taskId, start, end, snippet);

      const projectNameRow = context.db
        .prepare("SELECT name FROM projects WHERE id = ?")
        .get(msg.project_id) as { name: string } | undefined;
      if (projectNameRow?.name) {
        unlockProjectNavFeature(context.db, projectNameRow.name, "tasks");
      }

      recordEvent(context.db, "task.from_selection", { taskId, messageId: msg.id }, msg.project_id);

      const response: TaskSelectionResponse = { ok: true, taskId };
      return response;
    }
  );
}
