import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";

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
}
