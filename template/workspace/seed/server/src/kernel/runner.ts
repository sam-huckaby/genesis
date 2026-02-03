import { spawn } from "node:child_process";
import { resolveWorkspacePath } from "../util/paths.js";
import type { RunSpec } from "../adapters/adapter.types.js";

export type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function runSpec(
  workspaceDir: string,
  spec: RunSpec
): Promise<RunResult> {
  const cwd = resolveWorkspacePath(workspaceDir, spec.cwdRel);

  return new Promise((resolve) => {
    const child = spawn(spec.cmd, spec.args, {
      cwd,
      env: { ...process.env, ...(spec.env ?? {}) },
      shell: true
    });

    if (spec.stdin && child.stdin) {
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
