import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "./app.js";

type SeedConfig = {
  serverPort?: number;
};

function readSeedConfig(): SeedConfig {
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceDir = path.resolve(serverDir, "..", "..", "..", "..");
  const configPath = path.join(workspaceDir, "seed.config.json");
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw) as SeedConfig;
  } catch {
    return {};
  }
}

const server = await buildServer();
const config = readSeedConfig();
const port = config.serverPort ?? 3333;

server.listen({ port }, (err?: Error) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  }
  server.log.info(`Seed server running at http://localhost:${port}`);
});
