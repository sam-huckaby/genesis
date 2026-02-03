import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import path from "node:path";
import fs from "node:fs";
import middie from "@fastify/middie";
import staticPlugin from "@fastify/static";
import { createServer as createViteServer } from "vite";
import { registerHealthRoutes } from "./routes/health.js";
import { registerOnboardingRoutes } from "./routes/onboarding.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerChatRoutes, registerProjectChatRoutes } from "./routes/chat.js";
import { registerDiscoveryRoutes } from "./routes/discovery.js";
import { registerChangesetRoutes } from "./routes/changesets.js";
import { openDb } from "./storage/db.js";
import { runMigrations } from "./storage/migrate.js";

function findWorkspaceRoot(startDir: string): string {
  let current = startDir;
  while (current !== path.dirname(current)) {
    const marker = path.join(current, "seed.config.json");
    if (fs.existsSync(marker)) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error("Seed workspace root not found. Run from inside a workspace.");
}

export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({ logger: true });

  const workspaceDir = findWorkspaceRoot(process.cwd());
  const uiRoot = path.join(workspaceDir, "seed", "ui", "web");
  const isProd = process.env.NODE_ENV === "production";

  const stateDir = path.join(workspaceDir, "state");
  fs.mkdirSync(stateDir, { recursive: true });

  const db = openDb(workspaceDir);
  runMigrations(db, path.join(workspaceDir, "seed", "server", "src"));

  registerHealthRoutes(server);
  registerOnboardingRoutes(server, { workspaceDir, db });
  registerDiscoveryRoutes(server, { workspaceDir, db });
  registerProjectRoutes(server, { workspaceDir, db });
  registerTaskRoutes(server, { workspaceDir, db });
  registerChatRoutes(server, { workspaceDir, db });
  registerProjectChatRoutes(server, { workspaceDir, db });
  registerChangesetRoutes(server, { workspaceDir, db });

  if (isProd) {
    await server.register(staticPlugin, {
      root: path.join(uiRoot, "dist"),
      prefix: "/"
    });

    server.get("/*", async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.raw.url?.startsWith("/api/")) {
        return reply.status(404).send();
      }
      return reply.sendFile("index.html");
    });
  } else {
    await server.register(middie);
    const vite = await createViteServer({
      root: uiRoot,
      server: { middlewareMode: true },
      appType: "custom"
    });

    server.use(vite.middlewares);

    server.get("/*", async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.raw.url?.startsWith("/api/")) {
        return reply.status(404).send();
      }
      const indexPath = path.join(uiRoot, "index.html");
      const template = fs.readFileSync(indexPath, "utf8");
      const html = await vite.transformIndexHtml(request.raw.url ?? "/", template);
      reply.type("text/html").send(html);
    });
  }

  return server;
}
