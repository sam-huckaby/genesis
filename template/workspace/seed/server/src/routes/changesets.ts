import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { recordEvent } from "../storage/events.js";
import {
  buildDiffFromFiles,
  cleanWorkingTree,
  createChangesetProposal,
  createStashFromDiff,
  ensureGitRepo,
  getGitStatus,
  getStashDiff,
  getWorkingDiff,
  parseUnifiedDiff,
  runGit,
  updateChangesetFiles,
  type DiffFile
} from "../kernel/changesets.js";
import type {
  ChangesetDetail,
  ChangesetProposalRequest,
  ChangesetProposalResponse,
  ChangesetRebuildRequest,
  ChangesetRebuildResponse,
  ChangesetSummary,
  ChangesetTestRequest
} from "@shared/types";

type RouteContext = {
  workspaceDir: string;
  db: Database.Database;
};


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
        const result = createChangesetProposal({
          workspaceDir: context.workspaceDir,
          db: context.db,
          projectName: body.projectName,
          summary: body.summary,
          diff: body.diff
        });
        const response: ChangesetProposalResponse = { changesetId: result.changesetId };
        return response;
      } catch (error) {
        const message = (error as Error).message;
        if (message === "Project not found") {
          return reply.status(404).send({ error: "Project not found" });
        }
        if (message === "Git repository not found in workspace") {
          return reply.status(400).send({ error: "Git repository required" });
        }
        if (message === "Diff touches sensitive paths") {
          return reply.status(400).send({ error: "Diff touches sensitive paths" });
        }
        if (message === "Patch conflict") {
          return reply.status(409).send({ error: "Patch conflict" });
        }
        throw error;
      }
    }
  );

  server.get("/api/changesets/pending", async () => {
    const rows = context.db
      .prepare(
        "SELECT id, summary, status, created_at FROM changesets WHERE status IN ('pending', 'blocked', 'rebuilding', 'draft') ORDER BY created_at DESC"
      )
      .all() as { id: number; summary: string; status: string; created_at: string }[];

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
        .prepare(
          "SELECT id, summary, status, base_revision, created_at, parent_id, close_reason FROM changesets WHERE id = ?"
        )
        .get(id) as
        | {
            id: number;
            summary: string;
            status: string;
            base_revision: string;
            created_at: string;
            parent_id: number | null;
            close_reason: string | null;
          }
        | undefined;

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
        createdAt: changeset.created_at,
        parentId: changeset.parent_id,
        closeReason: changeset.close_reason,
        stashRef: null,
        files: files.map((file) => ({ path: file.path, diff: file.diff_text }))
      };

      const stashRow = context.db
        .prepare("SELECT stash_ref FROM changesets WHERE id = ?")
        .get(id) as { stash_ref: string | null } | undefined;
      response.stashRef = stashRow?.stash_ref ?? null;

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

      if (changeset.status !== "pending" && changeset.status !== "draft") {
        return reply.status(400).send({ error: "Changeset not pending or draft" });
      }

      const status = getGitStatus(context.workspaceDir);
      if (status.length > 0) {
        return reply.status(409).send({ error: "Working tree not clean" });
      }

      const stashRef = context.db
        .prepare("SELECT stash_ref FROM changesets WHERE id = ?")
        .get(id) as { stash_ref: string | null } | undefined;

      if (!stashRef?.stash_ref) {
        return reply.status(500).send({ error: "Missing stash reference" });
      }

      try {
        execFileSync("git", ["stash", "apply", stashRef.stash_ref], {
          cwd: context.workspaceDir,
          stdio: "pipe"
        });
      } catch {
        context.db
          .prepare("UPDATE changesets SET status = ? WHERE id = ?")
          .run("blocked", id);
        recordEvent(context.db, "changeset.blocked", { changesetId: id }, changeset.project_id);
        return reply.status(409).send({ error: "Patch conflict" });
      }
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
        .prepare(
          "UPDATE changesets SET status = ?, commit_hash = ?, project_commit_hash = ? WHERE id = ?"
        )
        .run("applied", commitHash, projectCommitHash, id);

      execFileSync("git", ["stash", "drop", stashRef.stash_ref], {
        cwd: context.workspaceDir,
        stdio: "pipe"
      });

      recordEvent(
        context.db,
        "changeset.applied",
        { changesetId: id, commitHash, projectCommitHash },
        changeset.project_id
      );

      return { ok: true, commitHash, projectCommitHash };
    }
  );

  server.post(
    "/api/changesets/:id/test",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = Number((request.params as { id?: string }).id);
      const body = request.body as ChangesetTestRequest;
      if (!id) {
        return reply.status(400).send({ error: "Missing changeset id" });
      }
      const stashRow = context.db
        .prepare("SELECT stash_ref, project_id FROM changesets WHERE id = ?")
        .get(id) as { stash_ref: string | null; project_id: number } | undefined;

      if (!stashRow?.stash_ref) {
        return reply.status(500).send({ error: "Missing stash reference" });
      }

      const status = getGitStatus(context.workspaceDir);
      if (status.length > 0) {
        const diff = getWorkingDiff(context.workspaceDir);
        const stashDiff = getStashDiff(context.workspaceDir, stashRow.stash_ref);
        if (diff.trim() === stashDiff.trim()) {
          return { applied: true };
        }
        if (!body?.force) {
          return reply.status(409).send({ warning: "Working tree not clean" });
        }
        cleanWorkingTree(context.workspaceDir);
      }

      try {
        execFileSync("git", ["stash", "apply", stashRow.stash_ref], {
          cwd: context.workspaceDir,
          stdio: "pipe"
        });
      } catch {
        context.db
          .prepare("UPDATE changesets SET status = ? WHERE id = ?")
          .run("blocked", id);
        recordEvent(context.db, "changeset.blocked", { changesetId: id }, stashRow.project_id);
        return reply.status(409).send({ error: "Patch conflict" });
      }

      return { applied: true };
    }
  );

  server.post(
    "/api/changesets/:id/stop-test",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = Number((request.params as { id?: string }).id);
      if (!id) {
        return reply.status(400).send({ error: "Missing changeset id" });
      }
      cleanWorkingTree(context.workspaceDir);
      return { ok: true };
    }
  );

  server.post(
    "/api/changesets/:id/close",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = Number((request.params as { id?: string }).id);
      const body = request.body as { reason?: string };
      if (!id) {
        return reply.status(400).send({ error: "Missing changeset id" });
      }
      context.db
        .prepare("UPDATE changesets SET status = ?, close_reason = ? WHERE id = ?")
        .run("rejected", body?.reason ?? null, id);
      recordEvent(context.db, "changeset.closed", { changesetId: id }, undefined);
      return { ok: true };
    }
  );

  server.post(
    "/api/changesets/:id/rebuild",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = Number((request.params as { id?: string }).id);
      const body = request.body as ChangesetRebuildRequest | undefined;
      const mode = body?.mode ?? "branch";
      if (!id) {
        return reply.status(400).send({ error: "Missing changeset id" });
      }
      const changeset = context.db
        .prepare(
          "SELECT id, project_id, summary, status, stash_ref, base_revision FROM changesets WHERE id = ?"
        )
        .get(id) as
        | {
            id: number;
            project_id: number;
            summary: string;
            status: string;
            stash_ref: string | null;
            base_revision: string;
          }
        | undefined;

      if (!changeset) {
        return reply.status(404).send({ error: "Changeset not found" });
      }

      if (changeset.status === "rebuilding") {
        return reply.status(409).send({ error: "Rebuild already in progress" });
      }
      const status = getGitStatus(context.workspaceDir);
      if (status.length > 0) {
        return reply.status(409).send({ error: "Working tree not clean" });
      }

      context.db.prepare("UPDATE changesets SET status = ? WHERE id = ?").run("rebuilding", id);

      const summary = body?.summary?.trim() || changeset.summary;
      const diffText = body?.diff?.trim();
      const files = diffText
        ? parseUnifiedDiff(diffText)
        : (context.db
            .prepare("SELECT path, diff_text FROM changeset_files WHERE changeset_id = ?")
            .all(id) as { path: string; diff_text: string }[]
          ).map((file) => ({ path: file.path, diff: file.diff_text }));
      const fullDiff = diffText ?? buildDiffFromFiles(files);

      if (!fullDiff.trim()) {
        context.db.prepare("UPDATE changesets SET status = ? WHERE id = ?").run("pending", id);
        return reply.status(400).send({ error: "Missing diff for rebuild" });
      }

      try {
        if (mode === "replace") {
          const stashRef = createStashFromDiff(
            context.workspaceDir,
            fullDiff,
            `seed: changeset ${id} - ${summary}`
          );
          updateChangesetFiles(context.db, id, files);
          const baseRevision = runGit(context.workspaceDir, ["rev-parse", "HEAD"]);
          context.db
            .prepare("UPDATE changesets SET status = ?, summary = ?, base_revision = ?, stash_ref = ? WHERE id = ?")
            .run("pending", summary, baseRevision, stashRef, id);
          recordEvent(
            context.db,
            "changeset.updated",
            { changesetId: id, stashRef },
            changeset.project_id
          );
          const response: ChangesetRebuildResponse = { ok: true, stashRef };
          return response;
        }

        const baseRevision = runGit(context.workspaceDir, ["rev-parse", "HEAD"]);
        const now = new Date().toISOString();
        const insertStmt = context.db.prepare(
          "INSERT INTO changesets (project_id, status, summary, base_revision, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        );
        const info = insertStmt.run(changeset.project_id, "pending", summary, baseRevision, id, now);
        const newId = Number(info.lastInsertRowid);

        updateChangesetFiles(context.db, newId, files);
        const stashRef = createStashFromDiff(
          context.workspaceDir,
          fullDiff,
          `seed: changeset ${newId} - ${summary}`
        );
        context.db
          .prepare("UPDATE changesets SET stash_ref = ? WHERE id = ?")
          .run(stashRef, newId);
        context.db.prepare("UPDATE changesets SET status = ? WHERE id = ?").run("pending", id);
        recordEvent(
          context.db,
          "changeset.branched",
          { changesetId: newId, parentId: id, stashRef },
          changeset.project_id
        );

        const response: ChangesetRebuildResponse = {
          ok: true,
          stashRef,
          changesetId: newId,
          parentId: id
        };
        return response;
      } catch {
        context.db.prepare("UPDATE changesets SET status = ? WHERE id = ?").run("blocked", id);
        recordEvent(context.db, "changeset.blocked", { changesetId: id }, changeset.project_id);
        return reply.status(409).send({ error: "Patch conflict" });
      }
    }
  );

  server.get(
    "/api/changesets/:id/messages",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = Number((request.params as { id?: string }).id);
      if (!id) {
        return reply.status(400).send({ error: "Missing changeset id" });
      }
      const rows = context.db
        .prepare(
          "SELECT role, content, created_at FROM changeset_messages WHERE changeset_id = ? ORDER BY id"
        )
        .all(id) as { role: string; content: string; created_at: string }[];
      return { messages: rows };
    }
  );

  server.post(
    "/api/changesets/:id/messages",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = Number((request.params as { id?: string }).id);
      const body = request.body as { role?: string; content?: string };
      if (!id || !body?.role || !body?.content) {
        return reply.status(400).send({ error: "Missing message fields" });
      }
      const stmt = context.db.prepare(
        "INSERT INTO changeset_messages (changeset_id, role, content, created_at) VALUES (?, ?, ?, ?)"
      );
      stmt.run(id, body.role, body.content, new Date().toISOString());
      return { ok: true };
    }
  );
}
