import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { runProjectChatLlm } from "../kernel/project_chat.js";
import {
  publishProjectChatEvent,
  subscribeProjectChatEvents
} from "../util/project_chat_events.js";
type RouteContext = {
  workspaceDir: string;
  db: Database.Database;
};

export function registerChatRoutes(
  server: FastifyInstance,
  _context: RouteContext
) {
  server.post("/api/chat", async () => {
    return { reply: "" };
  });
}

export function registerProjectChatRoutes(
  server: FastifyInstance,
  context: RouteContext
) {
  server.get(
    "/api/projects/:name/messages",
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

      const messages = context.db
        .prepare(
          "SELECT id, role, content, created_at, kind, status, tool_name, tool_meta FROM messages WHERE project_id = ?"
        )
        .all(project.id) as {
        id: number;
        role: string;
        content: string;
        created_at: string;
        kind: string | null;
        status: string | null;
        tool_name: string | null;
        tool_meta: string | null;
      }[];

      const selectionStmt = context.db.prepare(
        "SELECT message_id, start_offset, end_offset FROM task_selections WHERE message_id = ?"
      );

      const enriched = messages.map((msg) => {
        const selections = selectionStmt.all(msg.id) as {
          message_id: number;
          start_offset: number;
          end_offset: number;
        }[];
        return {
          id: msg.id,
          role: msg.role,
          content: msg.content,
          createdAt: msg.created_at,
          kind: msg.kind === "tool" ? "tool" : "message",
          status:
            msg.status === "running" || msg.status === "done" || msg.status === "error"
              ? msg.status
              : undefined,
          toolName: msg.tool_name,
          toolMeta: msg.tool_meta,
          selections: selections.map((sel) => ({
            start: sel.start_offset,
            end: sel.end_offset
          }))
        };
      });

      return { messages: enriched };
    }
  );

  server.post(
    "/api/projects/:name/messages",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      const body = request.body as { role?: string; content?: string };

      if (!name || !body?.role || !body?.content) {
        return reply.status(400).send({ error: "Missing fields" });
      }

      const project = context.db
        .prepare("SELECT id FROM projects WHERE name = ?")
        .get(name) as { id: number } | undefined;

      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const stmt = context.db.prepare(
        "INSERT INTO messages (project_id, role, content, kind, created_at) VALUES (?, ?, ?, ?, ?)"
      );
      const info = stmt.run(
        project.id,
        body.role,
        body.content,
        "message",
        new Date().toISOString()
      );

      return { id: Number(info.lastInsertRowid) };
    }
  );

  server.post(
    "/api/projects/:name/chat",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      const body = request.body as { role?: string; content?: string; mode?: string };
      const mode = body?.mode === "build" ? "build" : "plan";

      if (!name || !body?.role || !body?.content) {
        return reply.status(400).send({ error: "Missing fields" });
      }

      const project = context.db
        .prepare("SELECT id, root_path_rel FROM projects WHERE name = ?")
        .get(name) as { id: number; root_path_rel: string } | undefined;

      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const userStmt = context.db.prepare(
        "INSERT INTO messages (project_id, role, content, kind, created_at) VALUES (?, ?, ?, ?, ?)"
      );
      const now = new Date().toISOString();
      const userInfo = userStmt.run(
        project.id,
        body.role,
        body.content,
        "message",
        now
      );

      const secretsPath = path.join(context.workspaceDir, "state", "secrets", "openai.json");
      if (!fs.existsSync(secretsPath)) {
        return reply.status(400).send({ ok: false, error: "Missing OpenAI API key" });
      }
      const apiKey = JSON.parse(fs.readFileSync(secretsPath, "utf8")).apiKey as string;

      const rows = context.db
        .prepare("SELECT role, content FROM messages WHERE project_id = ? ORDER BY id")
        .all(project.id) as { role: "user" | "assistant"; content: string }[];

      let assistantContent = "";
      try {
        const logPath = path.join(context.workspaceDir, "state", "logs", "project-chat.log");
        const projectRootAbs = path.join(context.workspaceDir, project.root_path_rel);
        assistantContent = await runProjectChatLlm({
          apiKey,
          workspaceDir: context.workspaceDir,
          projectRootAbs,
          projectRootRel: project.root_path_rel,
          history: rows,
          mode,
          logPath,
          onToolStart: async ({ toolName, toolMeta, createdAt }) => {
            const toolStmt = context.db.prepare(
              "INSERT INTO messages (project_id, role, content, kind, status, tool_name, tool_meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            );
            const info = toolStmt.run(
              project.id,
              "assistant",
              toolMeta || toolName,
              "tool",
              "running",
              toolName,
              toolMeta,
              createdAt
            );
            const messageId = Number(info.lastInsertRowid);
            publishProjectChatEvent(project.id, {
              type: "tool_created",
              message: {
                id: messageId,
                role: "assistant",
                content: toolMeta || toolName,
                createdAt,
                kind: "tool",
                status: "running",
                toolName,
                toolMeta
              }
            });
            return messageId;
          },
          onToolEnd: async ({ messageId, status, summary }) => {
            context.db
              .prepare(
                "UPDATE messages SET status = ?, tool_meta = COALESCE(?, tool_meta) WHERE id = ?"
              )
              .run(status, summary ?? null, messageId);
            const row = context.db
              .prepare(
                "SELECT id, role, content, created_at, kind, status, tool_name, tool_meta FROM messages WHERE id = ?"
              )
              .get(messageId) as
              | {
                  id: number;
                  role: string;
                  content: string;
                  created_at: string;
                  kind: string | null;
                  status: string | null;
                  tool_name: string | null;
                  tool_meta: string | null;
                }
              | undefined;
            if (!row) {
              return;
            }
            publishProjectChatEvent(project.id, {
              type: "tool_updated",
              message: {
                id: row.id,
                role: row.role as "user" | "assistant",
                content: row.content,
                createdAt: row.created_at,
                kind: row.kind === "tool" ? "tool" : "message",
                status:
                  row.status === "running" || row.status === "done" || row.status === "error"
                    ? row.status
                    : undefined,
                toolName: row.tool_name,
                toolMeta: row.tool_meta
              }
            });
          }
        });

      } catch (error) {
        return reply.status(500).send({
          ok: false,
          error: (error as Error).message || "LLM request failed"
        });
      }

      const assistantStmt = context.db.prepare(
        "INSERT INTO messages (project_id, role, content, kind, created_at) VALUES (?, ?, ?, ?, ?)"
      );
      const assistantNow = new Date().toISOString();
      const assistantInfo = assistantStmt.run(
        project.id,
        "assistant",
        assistantContent,
        "message",
        assistantNow
      );

      publishProjectChatEvent(project.id, {
        type: "assistant_message",
        message: {
          id: Number(assistantInfo.lastInsertRowid),
          role: "assistant",
          content: assistantContent,
          createdAt: assistantNow,
          kind: "message"
        }
      });

      return {
        userMessage: {
          id: Number(userInfo.lastInsertRowid),
          role: body.role,
          content: body.content,
          createdAt: now,
          kind: "message"
        },
        assistantMessage: {
          id: Number(assistantInfo.lastInsertRowid),
          role: "assistant",
          content: assistantContent,
          createdAt: assistantNow,
          kind: "message"
        }
      };
    }
  );

  server.get(
    "/api/projects/:name/chat/stream",
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

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      reply.raw.write("\n");

      const sendEvent = (event: { type: string; message: unknown }) => {
        reply.raw.write(`event: ${event.type}\n`);
        reply.raw.write(`data: ${JSON.stringify(event.message)}\n\n`);
      };

      const unsubscribe = subscribeProjectChatEvents(project.id, sendEvent);
      const ping = setInterval(() => {
        reply.raw.write(": ping\n\n");
      }, 20000);

      request.raw.on("close", () => {
        clearInterval(ping);
        unsubscribe();
      });

      return reply;
    }
  );
}
