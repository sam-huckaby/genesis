import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type Database from "better-sqlite3";
import { recordEvent } from "../storage/events.js";
import { diffTouchesSensitivePath } from "../util/project_files.js";

// Changeset plumbing: validate diffs, stash them safely, and persist metadata.
export type DiffFile = { path: string; diff: string };

export function ensureGitRepo(workspaceDir: string) {
  // All changeset operations rely on git for diffs, stash, and patch apply.
  const gitDir = path.join(workspaceDir, ".git");
  if (!fs.existsSync(gitDir)) {
    throw new Error("Git repository not found in workspace");
  }
}

export function runGit(workspaceDir: string, args: string[]): string {
  // Helper wrapper for consistent cwd and encoding.
  return execFileSync("git", args, { cwd: workspaceDir, encoding: "utf8" }).trim();
}

export function getGitStatus(workspaceDir: string): string {
  return runGit(workspaceDir, ["status", "--porcelain"]);
}

export function getWorkingDiff(workspaceDir: string): string {
  return runGit(workspaceDir, ["diff"]);
}

export function getStashDiff(workspaceDir: string, stashRef: string): string {
  return runGit(workspaceDir, ["stash", "show", "-p", stashRef]);
}

export function parseUnifiedDiff(diff: string): DiffFile[] {
  // Split unified diff into file-level chunks keyed by a/ b/ paths.
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

export function buildDiffFromFiles(files: DiffFile[]): string {
  return files.map((file) => file.diff).join("\n");
}

export function updateChangesetFiles(db: Database.Database, changesetId: number, files: DiffFile[]) {
  // Replace the stored file list for a changeset atomically.
  const deleteStmt = db.prepare("DELETE FROM changeset_files WHERE changeset_id = ?");
  deleteStmt.run(changesetId);
  const insertStmt = db.prepare(
    "INSERT INTO changeset_files (changeset_id, path, diff_text) VALUES (?, ?, ?)"
  );
  files.forEach((file) => insertStmt.run(changesetId, file.path, file.diff));
}

export function writeTempPatch(workspaceDir: string, diff: string): string {
  // Persist the patch on disk so git can apply/check it.
  const dir = path.join(workspaceDir, "state", "patches");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `changeset-${Date.now()}.patch`);
  fs.writeFileSync(filePath, diff, "utf8");
  return filePath;
}

export function getLatestStashRef(workspaceDir: string): string {
  // Returns "stash@{0}" or empty string if no stash entries exist.
  const output = runGit(workspaceDir, ["stash", "list", "-n", "1", "--pretty=format:%gd"]);
  return output.split("\n")[0]?.trim() ?? "";
}

export function createStashFromDiff(workspaceDir: string, diff: string, message: string): string {
  // Apply the diff to a clean tree, stash it, then reset the workspace.
  const patchPath = writeTempPatch(workspaceDir, diff);
  try {
    checkPatchApplies(workspaceDir, patchPath);
    applyPatch(workspaceDir, patchPath);
    execFileSync("git", ["stash", "push", "-u", "-m", message], {
      cwd: workspaceDir,
      stdio: "pipe"
    });
    const stashRef = getLatestStashRef(workspaceDir);
    cleanWorkingTree(workspaceDir);
    return stashRef;
  } catch (error) {
    cleanWorkingTree(workspaceDir);
    throw error;
  }
}

export function cleanWorkingTree(workspaceDir: string) {
  // WARNING: This hard-resets and removes untracked files.
  execFileSync("git", ["reset", "--hard"], { cwd: workspaceDir, stdio: "pipe" });
  execFileSync("git", ["clean", "-fd"], { cwd: workspaceDir, stdio: "pipe" });
}

export function createChangesetProposal(params: {
  workspaceDir: string;
  db: Database.Database;
  projectName: string;
  summary: string;
  diff: string;
}): { changesetId: number; stashRef: string; files: DiffFile[] } {
  // Validate workspace, ensure diff is safe, and persist a changeset row.
  ensureGitRepo(params.workspaceDir);

  if (diffTouchesSensitivePath(params.diff)) {
    throw new Error("Diff touches sensitive paths");
  }

  const project = params.db
    .prepare("SELECT id FROM projects WHERE name = ?")
    .get(params.projectName) as { id: number } | undefined;

  if (!project) {
    throw new Error("Project not found");
  }

  const baseRevision = runGit(params.workspaceDir, ["rev-parse", "HEAD"]);
  const now = new Date().toISOString();
  const stmt = params.db.prepare(
    "INSERT INTO changesets (project_id, status, summary, base_revision, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const info = stmt.run(project.id, "pending", params.summary, baseRevision, now);
  const changesetId = Number(info.lastInsertRowid);

  const files = parseUnifiedDiff(params.diff);
  const fileStmt = params.db.prepare(
    "INSERT INTO changeset_files (changeset_id, path, diff_text) VALUES (?, ?, ?)"
  );
  files.forEach((file) => fileStmt.run(changesetId, file.path, file.diff));

  const fullDiff = files.map((file) => file.diff).join("\n");
  const patchPath = writeTempPatch(params.workspaceDir, fullDiff);

  try {
    checkPatchApplies(params.workspaceDir, patchPath);
  } catch (error) {
    throw new Error("Patch conflict");
  }

  applyPatch(params.workspaceDir, patchPath);
  execFileSync("git", ["stash", "push", "-u", "-m", `seed: changeset ${changesetId} - ${params.summary}`], {
    cwd: params.workspaceDir,
    stdio: "pipe"
  });
  const stashRef = getLatestStashRef(params.workspaceDir);
  cleanWorkingTree(params.workspaceDir);

  params.db
    .prepare("UPDATE changesets SET stash_ref = ? WHERE id = ?")
    .run(stashRef, changesetId);

  recordEvent(params.db, "changeset.proposed", { changesetId, stashRef }, project.id);

  return { changesetId, stashRef, files };
}

function checkPatchApplies(workspaceDir: string, patchPath: string) {
  // First try a strict check, then retry with --recount for fuzzy offsets.
  try {
    execFileSync("git", ["apply", "--check", patchPath], {
      cwd: workspaceDir,
      stdio: "pipe"
    });
    return;
  } catch {
    execFileSync("git", ["apply", "--check", "--recount", patchPath], {
      cwd: workspaceDir,
      stdio: "pipe"
    });
  }
}

function applyPatch(workspaceDir: string, patchPath: string) {
  // Apply with --recount to tolerate minor line drift.
  execFileSync("git", ["apply", "--recount", patchPath], {
    cwd: workspaceDir,
    stdio: "pipe"
  });
}
