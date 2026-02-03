import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { recordEvent } from "../storage/events.js";
import type {
  ChangesetDetail,
  ChangesetProposalRequest,
  ChangesetProposalResponse,
  ChangesetSummary
} from "@shared/types";

type RouteContext = {
  workspaceDir: string;
  db: Database.Database;
};

type DiffFile = { path: string; diff: string };

function ensureGitRepo(workspaceDir: string) {
  const gitDir = path.join(workspaceDir, ".git");
  if (!fs.existsSync(gitDir)) {
    throw new Error("Git repository not found in workspace");
  }
}

function runGit(workspaceDir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: workspaceDir, encoding: "utf8" }).trim();
}

function getGitStatus(workspaceDir: string): string {
  return runGit(workspaceDir, ["status", "--porcelain"]);
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

function writeTempPatch(workspaceDir: string, diff: string): string {
  const dir = path.join(workspaceDir, "state", "patches");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `changeset-${Date.now()}.patch`);
  fs.writeFileSync(filePath, diff, "utf8");
  return filePath;
}

export function registerChangesetRoutes(
  server: FastifyInstance,
  context: RouteContext
) {
  server.post(
    "/api/changesets/propose",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as ChangesetProposalRequest;
      if (!body?.projectName || !body?.summary || !body?.diff) {
        return reply.status(400).send({ error: "Missing proposal fields" });
      }

      try {
        ensureGitRepo(context.workspaceDir);
      } catch (error) {
        return reply.status(400).send({ error: "Git repository required" });
      }

      const project = context.db
        .prepare("SELECT id FROM projects WHERE name = ?")
        .get(body.projectName) as { id: number } | undefined;

      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }

      const baseRevision = runGit(context.workspaceDir, ["rev-parse", "HEAD"]);
      const now = new Date().toISOString();
      const stmt = context.db.prepare(
        "INSERT INTO changesets (project_id, status, summary, base_revision, created_at) VALUES (?, ?, ?, ?, ?)"
      );
      const info = stmt.run(project.id, "pending", body.summary, baseRevision, now);
      const changesetId = Number(info.lastInsertRowid);

      const files = parseUnifiedDiff(body.diff);
      const fileStmt = context.db.prepare(
        "INSERT INTO changeset_files (changeset_id, path, diff_text) VALUES (?, ?, ?)"
      );
      files.forEach((file) => fileStmt.run(changesetId, file.path, file.diff));

      recordEvent(context.db, "changeset.proposed", { changesetId }, project.id);

      const response: ChangesetProposalResponse = { changesetId };
      return response;
    }
  );

  server.get("/api/changesets/pending", async () => {
    const rows = context.db
      .prepare("SELECT id, summary, status, created_at FROM changesets WHERE status = ?")
      .all("pending") as { id: number; summary: string; status: string; created_at: string }[];

    const response: ChangesetSummary[] = rows.map((row) => ({
      id: row.id,
      summary: row.summary,
      status: row.status,
      createdAt: row.created_at
    }));
    return { changesets: response };
  });

  server.get(
    "/api/changesets/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = Number((request.params as { id?: string }).id);
      if (!id) {
        return reply.status(400).send({ error: "Missing changeset id" });
      }

      const changeset = context.db
        .prepare("SELECT id, summary, status, base_revision FROM changesets WHERE id = ?")
        .get(id) as { id: number; summary: string; status: string; base_revision: string } | undefined;

      if (!changeset) {
        return reply.status(404).send({ error: "Changeset not found" });
      }

      const files = context.db
        .prepare("SELECT path, diff_text FROM changeset_files WHERE changeset_id = ?")
        .all(id) as { path: string; diff_text: string }[];

      const response: ChangesetDetail = {
        id: changeset.id,
        summary: changeset.summary,
        status: changeset.status,
        baseRevision: changeset.base_revision,
        files: files.map((file) => ({ path: file.path, diff: file.diff_text }))
      };

      return response;
    }
  );

  server.post(
    "/api/changesets/:id/apply",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = Number((request.params as { id?: string }).id);
      if (!id) {
        return reply.status(400).send({ error: "Missing changeset id" });
      }

      try {
        ensureGitRepo(context.workspaceDir);
      } catch {
        return reply.status(400).send({ error: "Git repository required" });
      }

      const changeset = context.db
        .prepare("SELECT id, project_id, summary, status, base_revision FROM changesets WHERE id = ?")
        .get(id) as
        | { id: number; project_id: number; summary: string; status: string; base_revision: string }
        | undefined;

      if (!changeset) {
        return reply.status(404).send({ error: "Changeset not found" });
      }

      if (changeset.status !== "pending") {
        return reply.status(400).send({ error: "Changeset not pending" });
      }

      const status = getGitStatus(context.workspaceDir);
      if (status.length > 0) {
        return reply.status(409).send({ error: "Working tree not clean" });
      }

      const files = context.db
        .prepare("SELECT diff_text FROM changeset_files WHERE changeset_id = ?")
        .all(id) as { diff_text: string }[];
      const fullDiff = files.map((file) => file.diff_text).join("\n");
      const patchPath = writeTempPatch(context.workspaceDir, fullDiff);

      try {
        execFileSync("git", ["apply", "--check", patchPath], {
          cwd: context.workspaceDir,
          stdio: "pipe"
        });
      } catch (error) {
        context.db
          .prepare("UPDATE changesets SET status = ? WHERE id = ?")
          .run("blocked", id);
        recordEvent(context.db, "changeset.blocked", { changesetId: id }, changeset.project_id);
        return reply.status(409).send({ error: "Patch conflict" });
      }

      execFileSync("git", ["apply", patchPath], { cwd: context.workspaceDir, stdio: "pipe" });
      execFileSync("git", ["add", "-A"], { cwd: context.workspaceDir, stdio: "pipe" });
      const commitMessage = `seed: apply changeset ${id} - ${changeset.summary}`;
      execFileSync("git", ["commit", "-m", commitMessage, "-m", `Seed-Changeset: ${id}`], {
        cwd: context.workspaceDir,
        stdio: "pipe"
      });

      const commitHash = runGit(context.workspaceDir, ["rev-parse", "HEAD"]);

      const projectRow = context.db
        .prepare("SELECT name, root_path_rel FROM projects WHERE id = ?")
        .get(changeset.project_id) as { name: string; root_path_rel: string } | undefined;

      if (!projectRow) {
        return reply.status(500).send({ error: "Project not found for changeset" });
      }

      const projectDir = path.join(context.workspaceDir, projectRow.root_path_rel);
      execFileSync("git", ["add", "-A"], { cwd: projectDir, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", `seed: ${changeset.summary}`], {
        cwd: projectDir,
        stdio: "pipe"
      });
      const projectCommitHash = runGit(projectDir, ["rev-parse", "HEAD"]);

      context.db
        .prepare("UPDATE changesets SET status = ?, commit_hash = ?, project_commit_hash = ? WHERE id = ?")
        .run("applied", commitHash, projectCommitHash, id);

      recordEvent(
        context.db,
        "changeset.applied",
        { changesetId: id, commitHash, projectCommitHash },
        changeset.project_id
      );

      return { ok: true, commitHash, projectCommitHash };
    }
  );
}
