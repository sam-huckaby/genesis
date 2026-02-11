import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export async function createTempDir(prefix = "seed-test-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeDir(target: string) {
  await fs.rm(target, { recursive: true, force: true });
}

export async function writeFile(root: string, rel: string, content: string) {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
}

export async function readFile(root: string, rel: string) {
  return fs.readFile(path.join(root, rel), "utf-8");
}

export function runGit(root: string, args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf-8" }).trim();
}

export function initGitRepo(root: string) {
  runGit(root, ["init"]);
}

export function gitCommit(root: string, message: string) {
  runGit(root, ["add", "-A"]);
  execFileSync(
    "git",
    ["-c", "user.email=seed@test", "-c", "user.name=Seed", "commit", "-m", message],
    { cwd: root, stdio: "ignore" }
  );
}

export async function createTempRepo() {
  const root = await createTempDir("seed-repo-");
  initGitRepo(root);
  return root;
}

export function getWorkspaceDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const serverDir = path.resolve(here, "..", "..");
  return path.resolve(serverDir, "..", "..");
}

export function requireRipgrep() {
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error(
      "ripgrep (rg) is required for tool tests. Install from https://github.com/BurntSushi/ripgrep"
    );
  }
}
