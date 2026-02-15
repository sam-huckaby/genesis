import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { runProjectChatLlm } from "../kernel/project_chat.js";
import { runBuildLoop } from "../kernel/build_loop.js";
import { getAdapterByType } from "../adapters/registry.js";
import type { ToolResult } from "../kernel/tools/tool_result.js";
import {
  publishProjectChatEvent,
  subscribeProjectChatEvents
} from "../util/project_chat_events.js";
type RouteContext = {
  workspaceDir: string;
  db: Database.Database;
};

type ConversationRow = {
  id: number;
  project_id: number;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  last_viewed_at: string | null;
};

function normalizeToolName(name: string): string {
  return name.replace(/^functions\./, "");
}

function clampNumber(input: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, input));
}

function readSetting(db: Database.Database, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function getProjectRow(db: Database.Database, name: string) {
  return db
    .prepare("SELECT id, root_path_rel, type FROM projects WHERE name = ?")
    .get(name) as { id: number; root_path_rel: string; type: string } | undefined;
}

function getProjectId(db: Database.Database, name: string) {
  return db
    .prepare("SELECT id FROM projects WHERE name = ?")
    .get(name) as { id: number } | undefined;
}

function getLastConversation(db: Database.Database, projectId: number): ConversationRow | undefined {
  return db
    .prepare(
      "SELECT id, project_id, title, created_at, updated_at, last_message_at, last_viewed_at FROM project_chat_conversations WHERE project_id = ? ORDER BY COALESCE(last_viewed_at, last_message_at, created_at) DESC LIMIT 1"
    )
    .get(projectId) as ConversationRow | undefined;
}

function ensureConversation(
  db: Database.Database,
  projectId: number,
  title?: string
): ConversationRow {
  const now = new Date().toISOString();
  const safeTitle = title && title.trim().length > 0 ? title.trim() : "Conversation";
  const info = db
    .prepare(
      "INSERT INTO project_chat_conversations (project_id, title, created_at, updated_at, last_message_at, last_viewed_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(projectId, safeTitle, now, now, null, null);
  const id = Number(info.lastInsertRowid);
  return {
    id,
    project_id: projectId,
    title: safeTitle,
    created_at: now,
    updated_at: now,
    last_message_at: null,
    last_viewed_at: null
  };
}

function normalizeTitle(input: string): string {
  const base = input.replace(/\s+/g, " ").trim();
  if (!base) {
    return "Conversation";
  }
  return base.length > 80 ? `${base.slice(0, 77)}...` : base;
}

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
    "/api/projects/:name/conversations",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      if (!name) {
        return reply.status(400).send({ error: "Missing project name" });
      }

      const project = getProjectId(context.db, name);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const rows = context.db
        .prepare(
          "SELECT id, project_id, title, created_at, updated_at, last_message_at, last_viewed_at FROM project_chat_conversations WHERE project_id = ? ORDER BY COALESCE(last_message_at, created_at) DESC"
        )
        .all(project.id) as ConversationRow[];

      return {
        conversations: rows.map((row) => ({
          id: row.id,
          projectId: row.project_id,
          title: row.title,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          lastMessageAt: row.last_message_at,
          lastViewedAt: row.last_viewed_at
        }))
      };
    }
  );

  server.post(
    "/api/projects/:name/conversations",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      const body = request.body as { title?: string };
      if (!name) {
        return reply.status(400).send({ error: "Missing project name" });
      }

      const project = getProjectId(context.db, name);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const title = body?.title ? normalizeTitle(body.title) : "Conversation";
      const conversation = ensureConversation(context.db, project.id, title);
      return {
        conversation: {
          id: conversation.id,
          projectId: conversation.project_id,
          title: conversation.title,
          createdAt: conversation.created_at,
          updatedAt: conversation.updated_at,
          lastMessageAt: conversation.last_message_at,
          lastViewedAt: conversation.last_viewed_at
        }
      };
    }
  );

  server.post(
    "/api/projects/:name/conversations/:id/view",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      const conversationId = Number((request.params as { id?: string }).id);
      if (!name || !Number.isFinite(conversationId)) {
        return reply.status(400).send({ error: "Missing project name or conversation" });
      }

      const project = getProjectId(context.db, name);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const exists = context.db
        .prepare("SELECT id FROM project_chat_conversations WHERE id = ? AND project_id = ?")
        .get(conversationId, project.id) as { id: number } | undefined;
      if (!exists) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const now = new Date().toISOString();
      context.db
        .prepare("UPDATE project_chat_conversations SET last_viewed_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, conversationId);
      return { ok: true };
    }
  );

  server.get(
    "/api/projects/:name/conversations/:id/messages",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      const conversationId = Number((request.params as { id?: string }).id);
      if (!name || !Number.isFinite(conversationId)) {
        return reply.status(400).send({ error: "Missing project name or conversation" });
      }

      const project = getProjectId(context.db, name);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const conversation = context.db
        .prepare("SELECT id FROM project_chat_conversations WHERE id = ? AND project_id = ?")
        .get(conversationId, project.id) as { id: number } | undefined;
      if (!conversation) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const messages = context.db
        .prepare(
          "SELECT id, role, content, created_at, kind, status, tool_name, tool_meta FROM messages WHERE project_id = ? AND conversation_id = ? ORDER BY id"
        )
        .all(project.id, conversationId) as {
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
          conversationId,
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

  server.get(
    "/api/projects/:name/messages",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      if (!name) {
        return reply.status(400).send({ error: "Missing project name" });
      }

      const project = getProjectId(context.db, name);

      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const conversationIdParam = (request.query as { conversationId?: string }).conversationId;
      const parsedId = conversationIdParam ? Number(conversationIdParam) : NaN;
      const conversation = Number.isFinite(parsedId)
        ? (context.db
            .prepare(
              "SELECT id, project_id, title, created_at, updated_at, last_message_at, last_viewed_at FROM project_chat_conversations WHERE id = ? AND project_id = ?"
            )
            .get(parsedId, project.id) as ConversationRow | undefined)
        : getLastConversation(context.db, project.id);

      if (!conversation) {
        return { messages: [] };
      }

      const messages = context.db
        .prepare(
          "SELECT id, role, content, created_at, kind, status, tool_name, tool_meta FROM messages WHERE project_id = ? AND conversation_id = ? ORDER BY id"
        )
        .all(project.id, conversation.id) as {
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
          conversationId: conversation.id,
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
      const body = request.body as { role?: string; content?: string; conversationId?: number };

      if (!name || !body?.role || !body?.content) {
        return reply.status(400).send({ error: "Missing fields" });
      }

      const project = getProjectId(context.db, name);

      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const providedConversationId =
        typeof body.conversationId === "number" && Number.isFinite(body.conversationId)
          ? body.conversationId
          : undefined;
      const conversation = providedConversationId
        ? (context.db
            .prepare(
              "SELECT id, project_id, title, created_at, updated_at, last_message_at, last_viewed_at FROM project_chat_conversations WHERE id = ? AND project_id = ?"
            )
            .get(providedConversationId, project.id) as ConversationRow | undefined)
        : getLastConversation(context.db, project.id) ??
          ensureConversation(context.db, project.id, normalizeTitle(body.content));

      if (!conversation) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const stmt = context.db.prepare(
        "INSERT INTO messages (project_id, conversation_id, role, content, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const now = new Date().toISOString();
      const info = stmt.run(
        project.id,
        conversation.id,
        body.role,
        body.content,
        "message",
        now
      );

      const normalizedTitle = normalizeTitle(body.content);
      context.db
        .prepare(
          "UPDATE project_chat_conversations SET last_message_at = ?, updated_at = ?, title = CASE WHEN last_message_at IS NULL THEN ? ELSE title END WHERE id = ?"
        )
        .run(now, now, normalizedTitle, conversation.id);

      return { id: Number(info.lastInsertRowid), conversationId: conversation.id };
    }
  );

  server.post(
    "/api/projects/:name/chat",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      const body = request.body as {
        role?: string;
        content?: string;
        mode?: string;
        conversationId?: number;
      };
      const mode = body?.mode === "build" ? "build" : "plan";

      if (!name || !body?.role || !body?.content) {
        return reply.status(400).send({ error: "Missing fields" });
      }

      const project = getProjectRow(context.db, name);

      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const providedConversationId =
        typeof body.conversationId === "number" && Number.isFinite(body.conversationId)
          ? body.conversationId
          : undefined;
      const conversation = providedConversationId
        ? (context.db
            .prepare(
              "SELECT id, project_id, title, created_at, updated_at, last_message_at, last_viewed_at FROM project_chat_conversations WHERE id = ? AND project_id = ?"
            )
            .get(providedConversationId, project.id) as ConversationRow | undefined)
        : getLastConversation(context.db, project.id) ??
          ensureConversation(context.db, project.id, normalizeTitle(body.content));

      if (!conversation) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const userStmt = context.db.prepare(
        "INSERT INTO messages (project_id, conversation_id, role, content, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const now = new Date().toISOString();
      const userInfo = userStmt.run(
        project.id,
        conversation.id,
        body.role,
        body.content,
        "message",
        now
      );

      const normalizedTitle = normalizeTitle(body.content);
      context.db
        .prepare(
          "UPDATE project_chat_conversations SET last_message_at = ?, updated_at = ?, title = CASE WHEN last_message_at IS NULL THEN ? ELSE title END WHERE id = ?"
        )
        .run(now, now, normalizedTitle, conversation.id);

      publishProjectChatEvent(project.id, {
        type: "user_message",
        conversationId: conversation.id,
        message: {
          id: Number(userInfo.lastInsertRowid),
          conversationId: conversation.id,
          role: body.role as "user" | "assistant",
          content: body.content,
          createdAt: now,
          kind: "message"
        }
      });

      const secretsPath = path.join(context.workspaceDir, "state", "secrets", "openai.json");
      if (!fs.existsSync(secretsPath)) {
        return reply.status(400).send({ ok: false, error: "Missing OpenAI API key" });
      }
      const apiKey = JSON.parse(fs.readFileSync(secretsPath, "utf8")).apiKey as string;

      const rows = context.db
        .prepare(
          "SELECT role, content FROM messages WHERE project_id = ? AND conversation_id = ? ORDER BY id"
        )
        .all(project.id, conversation.id) as { role: "user" | "assistant"; content: string }[];

      const settingRow = context.db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get("project_chat_max_iterations") as { value: string } | undefined;
      const parsedMaxIterations = Number.parseInt(settingRow?.value ?? "", 10);
      const maxIterations = Number.isFinite(parsedMaxIterations) && parsedMaxIterations > 0
        ? parsedMaxIterations
        : 100;

      let assistantContent = "";
      try {
        const logPath = path.join(context.workspaceDir, "state", "logs", "project-chat.log");
        const projectRootAbs = path.join(context.workspaceDir, project.root_path_rel);
        const toolExecutor = async (call: { function: { name: string; arguments: string } })
          : Promise<ToolResult<unknown> | null> => {
          const toolName = normalizeToolName(call.function.name);
          if (
            toolName !== "build_loop_start" &&
            toolName !== "get_build_loops" &&
            toolName !== "get_build_loop_detail"
          ) {
            return null;
          }

          let args: Record<string, unknown> = {};
          try {
            args = call.function.arguments
              ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
              : {};
          } catch {
            return { ok: false, error: { code: "INVALID_ARGS", message: "Invalid tool arguments" } };
          }

          if (toolName === "build_loop_start") {
            const adapter = getAdapterByType(project.type as any);
            if (!adapter) {
              return {
                ok: false,
                error: { code: "PRECONDITION_FAILED", message: "Unsupported project type" }
              };
            }
            const buildCommand = adapter.commands(project.root_path_rel).build;
            if (!buildCommand) {
              return {
                ok: false,
                error: { code: "PRECONDITION_FAILED", message: "No build command configured" }
              };
            }

            const rawIterations = typeof args.maxIterations === "number" ? args.maxIterations : 20;
            const maxIterations = clampNumber(Math.floor(rawIterations), 1, 50);
            const modelSetting = readSetting(context.db, "build_loop_model") ?? "gpt-5.2";
            const modelOverride =
              typeof args.modelOverride === "string" && args.modelOverride.trim().length > 0
                ? args.modelOverride.trim()
                : undefined;
            const model = modelOverride ?? modelSetting;
            const maxToolIterationsRow = readSetting(context.db, "project_chat_max_iterations");
            const parsedToolMax = Number.parseInt(maxToolIterationsRow ?? "", 10);
            const toolMaxIterations =
              Number.isFinite(parsedToolMax) && parsedToolMax > 0 ? parsedToolMax : 100;
            const promptRow = context.db
              .prepare("SELECT prompt_text FROM project_build_prompts WHERE project_id = ?")
              .get(project.id) as { prompt_text: string } | undefined;
            const projectPrompt = promptRow?.prompt_text?.trim() ?? "";

            const result = await runBuildLoop({
              db: context.db,
              workspaceDir: context.workspaceDir,
              apiKey,
              project: {
                id: project.id,
                name,
                rootPathRel: project.root_path_rel
              },
              buildCommand,
              maxIterations,
              model,
              toolMaxIterations,
              projectPrompt
            });
            return { ok: true, result } as ToolResult<unknown>;
          }

          if (toolName === "get_build_loops") {
            const requestedProject =
              typeof args.projectName === "string" ? args.projectName.trim() : "";
            if (!requestedProject || requestedProject !== name) {
              return {
                ok: false,
                error: { code: "INVALID_ARGS", message: "Unknown project" }
              };
            }
            const rawLimit = typeof args.limit === "number" ? args.limit : 20;
            const limit = clampNumber(Math.floor(rawLimit), 1, 50);
            const loops = context.db
              .prepare(
                "SELECT id, status, max_iterations, stop_reason, model, created_at, updated_at FROM project_build_loops WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
              )
              .all(project.id, limit) as {
              id: number;
              status: string;
              max_iterations: number;
              stop_reason: string | null;
              model: string | null;
              created_at: string;
              updated_at: string;
            }[];
            return {
              ok: true,
              loops: loops.map((row) => ({
                id: row.id,
                status: row.status,
                maxIterations: row.max_iterations,
                stopReason: row.stop_reason,
                model: row.model,
                createdAt: row.created_at,
                updatedAt: row.updated_at
              }))
            } as ToolResult<unknown>;
          }

          if (toolName === "get_build_loop_detail") {
            const requestedProject =
              typeof args.projectName === "string" ? args.projectName.trim() : "";
            const loopIdArg = typeof args.loopId === "number" ? args.loopId : NaN;
            if (!requestedProject || requestedProject !== name || !Number.isFinite(loopIdArg)) {
              return {
                ok: false,
                error: { code: "INVALID_ARGS", message: "Invalid project or loopId" }
              };
            }
            const loopRow = context.db
              .prepare(
                "SELECT id, status, max_iterations, stop_reason, model, created_at, updated_at FROM project_build_loops WHERE id = ? AND project_id = ?"
              )
              .get(loopIdArg, project.id) as {
              id: number;
              status: string;
              max_iterations: number;
              stop_reason: string | null;
              model: string | null;
              created_at: string;
              updated_at: string;
            } | undefined;
            if (!loopRow) {
              return { ok: true, loop: null } as ToolResult<unknown>;
            }
            const iterations = context.db
              .prepare(
                "SELECT id, iteration, exit_code, stdout, stderr, assistant_summary, created_at FROM project_build_iterations WHERE loop_id = ? ORDER BY iteration"
              )
              .all(loopIdArg) as {
              id: number;
              iteration: number;
              exit_code: number;
              stdout: string;
              stderr: string;
              assistant_summary: string | null;
              created_at: string;
            }[];
            return {
              ok: true,
              loop: {
                id: loopRow.id,
                status: loopRow.status,
                maxIterations: loopRow.max_iterations,
                stopReason: loopRow.stop_reason,
                model: loopRow.model,
                createdAt: loopRow.created_at,
                updatedAt: loopRow.updated_at,
                iterations: iterations.map((row) => ({
                  id: row.id,
                  iteration: row.iteration,
                  exitCode: row.exit_code,
                  stdout: row.stdout,
                  stderr: row.stderr,
                  assistantSummary: row.assistant_summary,
                  createdAt: row.created_at
                }))
              }
            } as ToolResult<unknown>;
          }

          return null;
        };
        assistantContent = await runProjectChatLlm({
          apiKey,
          workspaceDir: context.workspaceDir,
          projectRootAbs,
          projectRootRel: project.root_path_rel,
          history: rows,
          mode,
          maxIterations,
          logPath,
          toolExecutor,
          onToolStart: async ({ toolName, toolMeta, createdAt }) => {
            const toolStmt = context.db.prepare(
              "INSERT INTO messages (project_id, conversation_id, role, content, kind, status, tool_name, tool_meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            );
            const info = toolStmt.run(
              project.id,
              conversation.id,
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
              conversationId: conversation.id,
              message: {
                id: messageId,
                conversationId: conversation.id,
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
              conversationId: conversation.id,
              message: {
                id: row.id,
                conversationId: conversation.id,
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
        "INSERT INTO messages (project_id, conversation_id, role, content, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const assistantNow = new Date().toISOString();
      const assistantInfo = assistantStmt.run(
        project.id,
        conversation.id,
        "assistant",
        assistantContent,
        "message",
        assistantNow
      );

      context.db
        .prepare(
          "UPDATE project_chat_conversations SET last_message_at = ?, updated_at = ? WHERE id = ?"
        )
        .run(assistantNow, assistantNow, conversation.id);

      publishProjectChatEvent(project.id, {
        type: "assistant_message",
        conversationId: conversation.id,
        message: {
          id: Number(assistantInfo.lastInsertRowid),
          conversationId: conversation.id,
          role: "assistant",
          content: assistantContent,
          createdAt: assistantNow,
          kind: "message"
        }
      });

      return {
        userMessage: {
          id: Number(userInfo.lastInsertRowid),
          conversationId: conversation.id,
          role: body.role,
          content: body.content,
          createdAt: now,
          kind: "message"
        },
        assistantMessage: {
          id: Number(assistantInfo.lastInsertRowid),
          conversationId: conversation.id,
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
      const conversationIdParam = (request.query as { conversationId?: string }).conversationId;
      const conversationId = conversationIdParam ? Number(conversationIdParam) : NaN;
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

      const sendEvent = (event: { type: string; conversationId: number; message: unknown }) => {
        if (Number.isFinite(conversationId) && event.conversationId !== conversationId) {
          return;
        }
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
