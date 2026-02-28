import { spawn } from "node:child_process";

// Shared async git runner for tool implementations.
export async function runGit(
  args: string[],
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => {
      stdout += data.toString("utf-8");
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString("utf-8");
    });
    proc.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
