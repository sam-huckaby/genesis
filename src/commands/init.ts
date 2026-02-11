import path from "node:path";
import { execFileSync } from "node:child_process";
import fs from "fs-extra";
import open from "open";
import { copyWorkspaceTemplate } from "../lib/copy.js";
import { installWorkspaceDeps } from "../lib/install.js";
import { startSeedServer } from "../lib/spawn.js";
import { validateRipgrep, validateWorkspaceName } from "../lib/validate.js";

type InitOptions = {
  skipInstall?: boolean;
};

export async function initCommand(workspaceName: string, options: InitOptions) {
  validateWorkspaceName(workspaceName);
  validateRipgrep();

  const targetDir = path.resolve(process.cwd(), workspaceName);

  if (await fs.pathExists(targetDir)) {
    console.error(`Directory already exists: ${targetDir}`);
    process.exit(1);
  }

  console.log(`Creating seed workspace: ${workspaceName}`);
  await fs.mkdirp(targetDir);

  console.log("Copying seed template...");
  await copyWorkspaceTemplate(targetDir);

  console.log("Writing seed.config.json...");
  await fs.writeJson(
    path.join(targetDir, "seed.config.json"),
    {
      seedVersion: "0.0.1",
      schemaVersion: 1,
      serverPort: 3333,
      activeProject: null
    },
    { spaces: 2 }
  );

  try {
    execFileSync("git", ["init"], { cwd: targetDir, stdio: "ignore" });
    execFileSync("git", ["add", "-A"], { cwd: targetDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "seed: initialize workspace"], {
      cwd: targetDir,
      stdio: "ignore"
    });
  } catch (error) {
    console.error("Git initialization failed. Ensure git is installed and configured.");
    process.exit(1);
  }

  if (options.skipInstall) {
    console.log("Skipped dependency install. Run bun install in:");
    console.log(`- ${path.join(targetDir, "seed", "server")}`);
    console.log(`- ${path.join(targetDir, "seed", "ui", "web")}`);
    console.log("Then start the server with: bun run dev (inside seed/server)");
    return;
  }

  console.log("Installing dependencies (bun)...");
  try {
    await installWorkspaceDeps(targetDir);
  } catch (error) {
    console.error("Dependency install failed.");
    process.exit(1);
  }

  console.log("Starting seed server...");
  const { url } = await startSeedServer(targetDir);

  console.log(`Opening ${url}`);
  await open(url);

  console.log("Seed workspace ready.");
}
