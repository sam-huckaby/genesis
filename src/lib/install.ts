import { spawn } from "node:child_process";
import path from "node:path";

function runBunInstall(targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["install"], {
      cwd: targetDir,
      stdio: "inherit",
      shell: true
    });

    child.on("close", (code) => {
      if (code && code !== 0) {
        reject(new Error(`bun install failed in ${targetDir}`));
      } else {
        resolve();
      }
    });
  });
}

export async function installWorkspaceDeps(workspaceDir: string): Promise<void> {
  const serverDir = path.join(workspaceDir, "seed", "server");
  const uiDir = path.join(workspaceDir, "seed", "ui", "web");

  await Promise.all([runBunInstall(serverDir), runBunInstall(uiDir)]);
}
