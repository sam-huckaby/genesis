import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { runProjectChatLlm } from "../kernel/project_chat.js";
import {
  publishProjectChatEvent,
  subscribeProjectChatEvents
} from "../util/project_chat_events.js";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { applyPatchText } from "../util/apply_patch.js";

type ToolResult = { ok: boolean; result?: unknown; error?: string };

type DraftChangeset = {
  id: number;
  stash_ref: string | null;
  summary: string;
};

type DiffFile = { path: string; diff: string };

function logGitCommand(logPath: string, cwd: string, args: string[], detail?: string) {
  const dir = path.join(logPath, "..");
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString();
  const command = `git ${args.join(" ")}`;
  const lines = [
    `[${timestamp}] cwd=${cwd}`,
    `command=${command}`,
    detail ? `detail=${detail}` : ""
  ].filter(Boolean);
  fs.appendFileSync(logPath, `${lines.join("\n")}\n\n`, "utf8");
}

function logDiagnostic(logPath: string, cwd: string, label: string, detail?: string) {
  logGitCommand(logPath, cwd, [`# ${label}`], detail);
}

function runGit(cwd: string, args: string[], logPath?: string): string {
  if (logPath) {
    logGitCommand(logPath, cwd, args);
  }
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  } catch (error) {
    if (logPath) {
      const err = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
      const stderr = err.stderr ? err.stderr.toString() : "";
      const stdout = err.stdout ? err.stdout.toString() : "";
      const detailParts = [err.message, stderr, stdout].filter((part) => part && part.length > 0);
      logGitCommand(logPath, cwd, args, detailParts.join(" | "));
    }
    throw error;
  }
}

function getGitStatus(cwd: string, logPath?: string): string {
  return runGit(cwd, ["status", "--porcelain"], logPath);
}

function ensureGitRepo(cwd: string) {
  const gitDir = path.join(cwd, ".git");
  if (!fs.existsSync(gitDir)) {
    throw new Error("Git repository not found in project");
  }
}

function parseUnifiedDiff(diff: string): DiffFile[] {
  const blocks = diff.split(/^diff --git /m).filter((part) => part.trim().length > 0);
  return blocks.map((block) => {
    const lines = block.split("\n");
    const header = lines[0] ?? "";
    const match = header.match(/a\/(.*?) b\//);
    const filePath = match?.[1] ?? "unknown";
    const content = `diff --git ${block}`;
    return { path: filePath, diff: content };
  });
}

function updateChangesetFiles(db: Database.Database, changesetId: number, files: DiffFile[]) {
  const deleteStmt = db.prepare("DELETE FROM changeset_files WHERE changeset_id = ?");
  deleteStmt.run(changesetId);
  const insertStmt = db.prepare(
    "INSERT INTO changeset_files (changeset_id, path, diff_text) VALUES (?, ?, ?)"
  );
  files.forEach((file) => insertStmt.run(changesetId, file.path, file.diff));
}

function cleanWorkingTree(cwd: string, logPath?: string) {
  runGit(cwd, ["reset", "--hard"], logPath);
  runGit(cwd, ["clean", "-fd"], logPath);
}

function getLatestStashRef(cwd: string, logPath?: string): string {
  const output = runGit(cwd, ["stash", "list", "-n", "1", "--pretty=format:%gd"], logPath);
  return output.split("\n")[0]?.trim() ?? "";
}


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
        const gitLogPath = path.join(context.workspaceDir, "state", "logs", "git-commands.log");
        const projectRootAbs = path.join(context.workspaceDir, project.root_path_rel);
        let patchFailureCount = 0;
        const toolExecutor = async (
          call: { function: { name: string; arguments: string } },
          _mode: "plan" | "build"
        ): Promise<ToolResult | null> => {
          if (call.function.name !== "patch_file") {
            return null;
          }
          if (mode !== "build") {
            return { ok: false, error: "patch_file not available in plan mode" };
          }
          if (patchFailureCount >= 2) {
            return {
              ok: false,
              error:
                "Patch retry limit reached. Hint: The file may have changed; read it again before retrying."
            };
          }

          let args: { diff?: string } = {};
          try {
            args = call.function.arguments
              ? (JSON.parse(call.function.arguments) as { diff?: string })
              : {};
          } catch {
            return { ok: false, error: "Invalid tool arguments" };
          }

          const diff = (args.diff ?? "").replace(/\r\n/g, "\n");
          if (!diff.trim()) {
            return { ok: false, error: "Missing diff" };
          }
          if (!diff.trimStart().startsWith("*** Begin Patch")) {
            return {
              ok: false,
              error: "Use apply_patch format with *** Begin Patch / *** End Patch blocks."
            };
          }

          try {
            ensureGitRepo(projectRootAbs);
          } catch (error) {
            return { ok: false, error: (error as Error).message };
          }

          const diffHash = crypto.createHash("sha256").update(diff).digest("hex").slice(0, 12);
          logDiagnostic(
            gitLogPath,
            projectRootAbs,
            "patch_file",
            `projectRootAbs diffLength=${diff.length} diffHash=${diffHash}`
          );
          const status = getGitStatus(projectRootAbs, gitLogPath);
          if (status.length > 0) {
            return { ok: false, error: "Working tree not clean" };
          }

          const draft = context.db
            .prepare(
              "SELECT id, stash_ref, summary FROM changesets WHERE project_id = ? AND status = 'draft' AND chat_session_id IS NULL ORDER BY id DESC LIMIT 1"
            )
            .get(project.id) as DraftChangeset | undefined;

          try {
            if (draft?.stash_ref) {
              runGit(projectRootAbs, ["stash", "apply", draft.stash_ref], gitLogPath);
            }
            applyPatchText(projectRootAbs, diff, (msg) =>
              logDiagnostic(gitLogPath, projectRootAbs, "apply_patch", msg)
            );
            runGit(projectRootAbs, ["stash", "push", "-u", "-m", `seed: chat draft ${project.id}`], gitLogPath);
            const newStashRef = getLatestStashRef(projectRootAbs, gitLogPath);
            const combinedDiff = runGit(
              projectRootAbs,
              ["stash", "show", "-p", "--include-untracked", newStashRef],
              gitLogPath
            );
            logDiagnostic(
              gitLogPath,
              projectRootAbs,
              "stash_diff",
              `stash=${newStashRef} diffLength=${combinedDiff.length}`
            );
            if (!combinedDiff.trim()) {
              cleanWorkingTree(projectRootAbs, gitLogPath);
              return { ok: false, error: "Patch produced no changes" };
            }
            cleanWorkingTree(projectRootAbs, gitLogPath);

            if (draft?.stash_ref) {
              try {
                runGit(projectRootAbs, ["stash", "drop", draft.stash_ref], gitLogPath);
              } catch {
                // ignore
              }
            }

            const files = parseUnifiedDiff(combinedDiff);
            const baseRevision = runGit(projectRootAbs, ["rev-parse", "HEAD"], gitLogPath);
            const now = new Date().toISOString();

            let changesetId = draft?.id;
            if (!changesetId) {
              const insertStmt = context.db.prepare(
                "INSERT INTO changesets (project_id, status, summary, base_revision, stash_ref, chat_session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
              );
              const info = insertStmt.run(
                project.id,
                "draft",
                "Chat draft",
                baseRevision,
                newStashRef,
                null,
                now
              );
              changesetId = Number(info.lastInsertRowid);
            } else {
              context.db
                .prepare(
                  "UPDATE changesets SET status = ?, base_revision = ?, stash_ref = ? WHERE id = ?"
                )
                .run("draft", baseRevision, newStashRef, changesetId);
            }

            updateChangesetFiles(context.db, changesetId, files);

            return { ok: true, result: { changesetId } };
          } catch (error) {
            cleanWorkingTree(projectRootAbs, gitLogPath);
            if (draft?.id) {
              context.db
                .prepare("UPDATE changesets SET status = ? WHERE id = ?")
                .run("blocked", draft.id);
            }
            patchFailureCount += 1;
            return {
              ok: false,
              error: `${(error as Error).message}. Hint: The file may have changed; read it again before retrying.`
            };
          }
        };

        assistantContent = await runProjectChatLlm({
          apiKey,
          projectRootAbs,
          projectRootRel: project.root_path_rel,
          history: rows,
          mode,
          logPath,
          toolExecutor,
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
