import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type Database from "better-sqlite3";
import { getAdapterByType } from "../adapters/registry.js";
import { runSpec } from "../kernel/runner.js";
import { applyPatchSet } from "../kernel/patch.js";
import { runBuildLoop } from "../kernel/build_loop.js";
import { recordEvent } from "../storage/events.js";
import type {
  CreateProjectRequest,
  CreateProjectResponse,
  ProjectBuildLoopRequest,
  ProjectBuildLoopResponse,
  ProjectBuildRunResponse,
  ProjectBuildLoopDetailResponse,
  ProjectBuildLoopListResponse,
  ProjectDeployRequest,
  ProjectDeployResponse,
  ProjectBuildPromptRequest,
  ProjectBuildPromptResponse,
  ProjectBrief,
  SaveProjectBriefRequest
} from "@shared/types";

type RouteContext = {
  workspaceDir: string;
  db: Database.Database;
};

function isValidProjectName(name: string): boolean {
  return /^[a-z0-9-]+$/.test(name);
}

function getGitStatus(dir: string): string {
  return execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).trim();
}

type ProjectRow = {
  id: number;
  root_path_rel: string;
  type: string;
};

function getProjectRow(db: Database.Database, name: string): ProjectRow | undefined {
  return db
    .prepare("SELECT id, root_path_rel, type FROM projects WHERE name = ?")
    .get(name) as ProjectRow | undefined;
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


export function registerProjectRoutes(
  server: FastifyInstance,
  context: RouteContext
) {
  server.post(
    "/api/projects/create",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as CreateProjectRequest;
      const name = body?.name;
      const type = body?.type;
      const toolPreference = body?.toolPreference;
      const brief = body?.brief?.trim();

      if (!name || !type) {
        return reply.status(400).send({ error: "Missing name or type" });
      }

      if (!isValidProjectName(name)) {
        return reply.status(400).send({ error: "Invalid project name" });
      }

      if (toolPreference && toolPreference !== "bun") {
        return reply.status(400).send({ error: "Only bun is supported" });
      }

      const projectPathRel = path.join("projects", name);
      const projectPathAbs = path.join(context.workspaceDir, projectPathRel);

      fs.mkdirSync(path.join(context.workspaceDir, "projects"), { recursive: true });

      if (fs.existsSync(projectPathAbs)) {
        return reply.status(409).send({ error: "Project already exists" });
      }

      const adapter = getAdapterByType(type);
      if (!adapter) {
        return reply.status(400).send({ error: "Unsupported project type" });
      }

      const initResult = await adapter.init(projectPathRel, {
        toolPreference: "bun"
      });

      for (const spec of initResult.runs) {
        const result = await runSpec(context.workspaceDir, spec);
        if (result.exitCode !== 0) {
          return reply.status(500).send({
            error: "Scaffold command failed",
            stdout: result.stdout,
            stderr: result.stderr
          });
        }
      }

      if (initResult.postPatch) {
        applyPatchSet(context.workspaceDir, initResult.postPatch);
      }

      if (brief && brief.length > 0) {
        applyPatchSet(context.workspaceDir, {
          description: "Add PROJECT_BRIEF.md",
          files: [
            {
              type: "write",
              pathRel: `${projectPathRel}/PROJECT_BRIEF.md`,
              content: `${brief.trim()}\n`
            }
          ]
        });
      }

      const projectGitDir = path.join(projectPathAbs, ".git");
      if (!fs.existsSync(projectGitDir)) {
        try {
          execFileSync("git", ["init"], { cwd: projectPathAbs, stdio: "ignore" });
        } catch {
          return reply.status(500).send({ error: "Failed to initialize project git repo" });
        }
      }

      try {
        if (getGitStatus(projectPathAbs).length > 0) {
          execFileSync("git", ["add", "."], { cwd: projectPathAbs, stdio: "ignore" });
          execFileSync("git", ["commit", "-m", "chore: scaffold project"], {
            cwd: projectPathAbs,
            stdio: "ignore"
          });
        }
      } catch {
        return reply.status(500).send({ error: "Failed to create baseline commit" });
      }

      const stmt = context.db.prepare(
        "INSERT INTO projects (name, type, root_path_rel, created_at) VALUES (?, ?, ?, ?)"
      );
      const info = stmt.run(
        name,
        type,
        projectPathRel,
        new Date().toISOString()
      );

      recordEvent(context.db, "project.created", { name, type }, Number(info.lastInsertRowid));
      recordEvent(
        context.db,
        "project.scaffold.executed",
        { name, type, tool: "bun" },
        Number(info.lastInsertRowid)
      );
      recordEvent(
        context.db,
        "tasks.suggested",
        { count: initResult.suggestedTasks.length },
        Number(info.lastInsertRowid)
      );

      if (brief && brief.length > 0) {
        const briefStmt = context.db.prepare(
          "INSERT INTO project_briefs (project_id, brief_text, created_at, updated_at) VALUES (?, ?, ?, ?)"
        );
        const now = new Date().toISOString();
        briefStmt.run(Number(info.lastInsertRowid), brief, now, now);
        recordEvent(
          context.db,
          "project.brief.created",
          { length: brief.length },
          Number(info.lastInsertRowid)
        );
      }

      const response: CreateProjectResponse = {
        project: {
          name,
          type,
          rootPathRel: projectPathRel
        },
        suggestedTasks: initResult.suggestedTasks,
        nextSteps: [{ message: "Review and accept suggested tasks." }]
      };

      return response;
    }
  );

  server.get(
    "/api/projects/:name/brief",
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

      const briefRow = context.db
        .prepare("SELECT brief_text FROM project_briefs WHERE project_id = ?")
        .get(project.id) as { brief_text: string } | undefined;

      const response: ProjectBrief = {
        projectName: name,
        briefText: briefRow?.brief_text ?? ""
      };

      return response;
    }
  );

  server.put(
    "/api/projects/:name/brief",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      const body = request.body as SaveProjectBriefRequest;

      if (!name || !body?.briefText) {
        return reply.status(400).send({ error: "Missing project name or brief" });
      }

      const project = context.db
        .prepare("SELECT id FROM projects WHERE name = ?")
        .get(name) as { id: number } | undefined;

      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const existing = context.db
        .prepare("SELECT id FROM project_briefs WHERE project_id = ?")
        .get(project.id) as { id: number } | undefined;

      const now = new Date().toISOString();
      if (existing) {
        context.db
          .prepare("UPDATE project_briefs SET brief_text = ?, updated_at = ? WHERE project_id = ?")
          .run(body.briefText, now, project.id);
      } else {
        context.db
          .prepare(
            "INSERT INTO project_briefs (project_id, brief_text, created_at, updated_at) VALUES (?, ?, ?, ?)"
          )
          .run(project.id, body.briefText, now, now);
      }

      recordEvent(context.db, "project.brief.updated", { length: body.briefText.length }, project.id);

      return { ok: true };
    }
  );

  server.post(
    "/api/projects/:name/build-prompt",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      const body = request.body as ProjectBuildPromptRequest;
      if (!name || !body?.prompt) {
        return reply.status(400).send({ error: "Missing project name or prompt" });
      }

      const project = context.db
        .prepare("SELECT id FROM projects WHERE name = ?")
        .get(name) as { id: number } | undefined;

      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      context.db.prepare("DELETE FROM project_build_prompts WHERE project_id = ?").run(project.id);
      context.db
        .prepare(
          "INSERT INTO project_build_prompts (project_id, prompt_text, created_at) VALUES (?, ?, ?)"
        )
        .run(project.id, body.prompt, new Date().toISOString());

      return { ok: true };
    }
  );

  server.get(
    "/api/projects/:name/build-prompt",
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

      const row = context.db
        .prepare("SELECT prompt_text, created_at FROM project_build_prompts WHERE project_id = ?")
        .get(project.id) as { prompt_text: string; created_at: string } | undefined;

      const response: ProjectBuildPromptResponse = row
        ? { prompt: row.prompt_text, createdAt: row.created_at }
        : {};

      return response;
    }
  );

  server.delete(
    "/api/projects/:name/build-prompt",
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

      context.db.prepare("DELETE FROM project_build_prompts WHERE project_id = ?").run(project.id);
      return { ok: true };
    }
  );

  server.post(
    "/api/projects/:name/build",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      if (!name) {
        return reply.status(400).send({ error: "Missing project name" });
      }

      const project = getProjectRow(context.db, name);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const adapter = getAdapterByType(project.type as any);
      if (!adapter) {
        const response: ProjectBuildRunResponse = {
          ok: false,
          exitCode: 1,
          stdout: "",
          stderr: "",
          message: "Unsupported project type"
        };
        return response;
      }

      const command = adapter.commands(project.root_path_rel).build;
      if (!command) {
        const response: ProjectBuildRunResponse = {
          ok: false,
          exitCode: 1,
          stdout: "",
          stderr: "",
          message: "No build command configured for this project"
        };
        return response;
      }

      recordEvent(context.db, "project.build.started", { name }, project.id);
      const result = await runSpec(context.workspaceDir, command);
      recordEvent(
        context.db,
        "project.build.finished",
        { name, exitCode: result.exitCode },
        project.id
      );

      const response: ProjectBuildRunResponse = {
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr
      };
      return response;
    }
  );

  server.post(
    "/api/projects/:name/test",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      if (!name) {
        return reply.status(400).send({ error: "Missing project name" });
      }

      const project = getProjectRow(context.db, name);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const adapter = getAdapterByType(project.type as any);
      if (!adapter) {
        const response: ProjectBuildRunResponse = {
          ok: false,
          exitCode: 1,
          stdout: "",
          stderr: "",
          message: "Unsupported project type"
        };
        return response;
      }

      const command = adapter.commands(project.root_path_rel).test;
      if (!command) {
        const response: ProjectBuildRunResponse = {
          ok: false,
          exitCode: 1,
          stdout: "",
          stderr: "",
          message: "No test command configured for this project"
        };
        return response;
      }

      recordEvent(context.db, "project.test.started", { name }, project.id);
      const result = await runSpec(context.workspaceDir, command);
      recordEvent(
        context.db,
        "project.test.finished",
        { name, exitCode: result.exitCode },
        project.id
      );

      const response: ProjectBuildRunResponse = {
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr
      };
      return response;
    }
  );

  server.post(
    "/api/projects/:name/deploy",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      const body = request.body as ProjectDeployRequest;
      if (!name) {
        return reply.status(400).send({ error: "Missing project name" });
      }

      const targetId = body?.targetId?.trim();
      if (!targetId) {
        const response: ProjectDeployResponse = {
          ok: false,
          exitCode: 1,
          stdout: "",
          stderr: "",
          message: "Missing targetId"
        };
        return response;
      }

      const project = getProjectRow(context.db, name);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const adapter = getAdapterByType(project.type as any);
      if (!adapter) {
        const response: ProjectDeployResponse = {
          ok: false,
          exitCode: 1,
          stdout: "",
          stderr: "",
          message: "Unsupported project type"
        };
        return response;
      }

      const targets = adapter.commands(project.root_path_rel).deployTargets ?? [];
      const target = targets.find((entry) => entry.id === targetId);
      if (!target) {
        const response: ProjectDeployResponse = {
          ok: false,
          exitCode: 1,
          stdout: "",
          stderr: "",
          message: "Unknown deploy target"
        };
        return response;
      }

      recordEvent(context.db, "project.deploy.started", { name, targetId }, project.id);
      const result = await runSpec(context.workspaceDir, target.spec);
      recordEvent(
        context.db,
        "project.deploy.finished",
        { name, targetId, exitCode: result.exitCode },
        project.id
      );

      const response: ProjectDeployResponse = {
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr
      };
      return response;
    }
  );

  server.post(
    "/api/projects/:name/build-loop",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      const body = request.body as ProjectBuildLoopRequest;
      if (!name) {
        return reply.status(400).send({ error: "Missing project name" });
      }

      const project = getProjectRow(context.db, name);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const adapter = getAdapterByType(project.type as any);
      if (!adapter) {
        const response: ProjectBuildLoopResponse = {
          ok: false,
          loopId: 0,
          lastIteration: null,
          message: "Unsupported project type"
        };
        return response;
      }

      const buildCommand = adapter.commands(project.root_path_rel).build;
      if (!buildCommand) {
        const response: ProjectBuildLoopResponse = {
          ok: false,
          loopId: 0,
          lastIteration: null,
          message: "No build command configured for this project"
        };
        return response;
      }

      const secretsPath = path.join(context.workspaceDir, "state", "secrets", "openai.json");
      if (!fs.existsSync(secretsPath)) {
        return reply.status(400).send({ ok: false, error: "Missing OpenAI API key" });
      }
      const apiKey = JSON.parse(fs.readFileSync(secretsPath, "utf8")).apiKey as string;

      const defaultIterations = 20;
      const requestedIterations = typeof body?.maxIterations === "number"
        ? body.maxIterations
        : defaultIterations;
      const maxIterations = clampNumber(Math.floor(requestedIterations), 1, 50);
      const modelSetting = readSetting(context.db, "build_loop_model") ?? "gpt-5.2";
      const modelOverride = typeof body?.modelOverride === "string" && body.modelOverride.trim().length > 0
        ? body.modelOverride.trim()
        : undefined;
      const model = modelOverride ?? modelSetting;
      const promptRow = context.db
        .prepare("SELECT prompt_text FROM project_build_prompts WHERE project_id = ?")
        .get(project.id) as { prompt_text: string } | undefined;
      const projectPrompt = promptRow?.prompt_text?.trim() ?? "";

      const maxToolIterationsRow = readSetting(context.db, "project_chat_max_iterations");
      const parsedToolMax = Number.parseInt(maxToolIterationsRow ?? "", 10);
      const toolMaxIterations = Number.isFinite(parsedToolMax) && parsedToolMax > 0
        ? parsedToolMax
        : 100;

      const response = await runBuildLoop({
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
      return response;
    }
  );

  server.get(
    "/api/projects/:name/build-loops",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      if (!name) {
        return reply.status(400).send({ error: "Missing project name" });
      }

      const project = getProjectRow(context.db, name);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const rows = context.db
        .prepare(
          "SELECT id, status, max_iterations, stop_reason, model, created_at, updated_at FROM project_build_loops WHERE project_id = ? ORDER BY created_at DESC"
        )
        .all(project.id) as {
        id: number;
        status: string;
        max_iterations: number;
        stop_reason: string | null;
        model: string | null;
        created_at: string;
        updated_at: string;
      }[];

      const response: ProjectBuildLoopListResponse = {
        loops: rows.map((row) => ({
          id: row.id,
          status: row.status,
          maxIterations: row.max_iterations,
          stopReason: row.stop_reason,
          model: row.model,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }))
      };
      return response;
    }
  );

  server.get(
    "/api/projects/:name/build-loops/:loopId",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const name = (request.params as { name?: string }).name;
      const loopId = Number((request.params as { loopId?: string }).loopId);
      if (!name || !Number.isFinite(loopId)) {
        return reply.status(400).send({ error: "Missing project name or loopId" });
      }

      const project = getProjectRow(context.db, name);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const loopRow = context.db
        .prepare(
          "SELECT id, status, max_iterations, stop_reason, model, created_at, updated_at FROM project_build_loops WHERE id = ? AND project_id = ?"
        )
        .get(loopId, project.id) as {
        id: number;
        status: string;
        max_iterations: number;
        stop_reason: string | null;
        model: string | null;
        created_at: string;
        updated_at: string;
      } | undefined;

      if (!loopRow) {
        const response: ProjectBuildLoopDetailResponse = { loop: null };
        return response;
      }

      const iterations = context.db
        .prepare(
          "SELECT id, iteration, exit_code, stdout, stderr, assistant_summary, created_at FROM project_build_iterations WHERE loop_id = ? ORDER BY iteration"
        )
        .all(loopId) as {
        id: number;
        iteration: number;
        exit_code: number;
        stdout: string;
        stderr: string;
        assistant_summary: string | null;
        created_at: string;
      }[];

      const response: ProjectBuildLoopDetailResponse = {
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
      };
      return response;
    }
  );
}
