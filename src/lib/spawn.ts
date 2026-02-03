import { spawn } from "node:child_process";
import path from "node:path";

export async function startSeedServer(
  workspaceDir: string
): Promise<{ url: string }> {
  const serverDir = path.join(workspaceDir, "seed", "server");

  spawn("bun", ["run", "dev"], {
    cwd: serverDir,
    stdio: "inherit",
    shell: true
  });

  const port = 3333;
  const url = `http://localhost:${port}`;

  return { url };
}
