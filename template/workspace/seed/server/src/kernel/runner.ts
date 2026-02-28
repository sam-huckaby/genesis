import { spawn } from "node:child_process";
import { resolveWorkspacePath } from "../util/paths.js";
import type { RunSpec } from "../adapters/adapter.types.js";

// Minimal process runner used by build and tool flows.
export type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function runSpec(
  workspaceDir: string,
  spec: RunSpec
): Promise<RunResult> {
  // Resolve cwd relative to the workspace and execute with merged env.
  const cwd = resolveWorkspacePath(workspaceDir, spec.cwdRel);

  return new Promise((resolve) => {
    const child = spawn(spec.cmd, spec.args, {
      cwd,
      env: { ...process.env, ...(spec.env ?? {}) },
      shell: true
    });

    if (spec.stdin && child.stdin) {
      // Some adapters rely on stdin for non-interactive commands.
      child.stdin.write(spec.stdin);
      child.stdin.end();
    }

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    }

    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr
      });
    });
  });
}
