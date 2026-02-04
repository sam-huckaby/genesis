import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { runProjectChatLlm } from "../kernel/project_chat.js";

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
        .prepare("SELECT id, role, content, created_at FROM messages WHERE project_id = ?")
        .all(project.id) as { id: number; role: string; content: string; created_at: string }[];

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
          ...msg,
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
        "INSERT INTO messages (project_id, role, content, created_at) VALUES (?, ?, ?, ?)"
      );
      const info = stmt.run(project.id, body.role, body.content, new Date().toISOString());

      return { id: Number(info.lastInsertRowid) };
    }
  );

  server.post(
    "/api/projects/:name/chat",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      const body = request.body as { role?: string; content?: string };

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
        "INSERT INTO messages (project_id, role, content, created_at) VALUES (?, ?, ?, ?)"
      );
      const userInfo = userStmt.run(project.id, body.role, body.content, new Date().toISOString());

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
        assistantContent = await runProjectChatLlm({
          apiKey,
          projectRootAbs: path.join(context.workspaceDir, project.root_path_rel),
          projectRootRel: project.root_path_rel,
          history: rows
        });
      } catch (error) {
        return reply.status(500).send({
          ok: false,
          error: (error as Error).message || "LLM request failed"
        });
      }

      const assistantStmt = context.db.prepare(
        "INSERT INTO messages (project_id, role, content, created_at) VALUES (?, ?, ?, ?)"
      );
      const assistantInfo = assistantStmt.run(
        project.id,
        "assistant",
        assistantContent,
        new Date().toISOString()
      );

      return {
        userMessage: {
          id: Number(userInfo.lastInsertRowid),
          role: body.role,
          content: body.content
        },
        assistantMessage: {
          id: Number(assistantInfo.lastInsertRowid),
          role: "assistant",
          content: assistantContent
        }
      };
    }
  );
}
