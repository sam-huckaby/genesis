import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type Database from "better-sqlite3";
import { getAdapterByType } from "../adapters/registry.js";
import { runSpec } from "../kernel/runner.js";
import { applyPatchSet } from "../kernel/patch.js";
import { recordEvent } from "../storage/events.js";
import type {
  CreateProjectRequest,
  CreateProjectResponse,
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
}
