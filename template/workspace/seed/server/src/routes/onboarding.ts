import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { recordEvent } from "../storage/events.js";

type RouteContext = {
  workspaceDir: string;
  db: Database.Database;
};

type SeedConfig = {
  activeProject?: string | null;
};

function readSeedConfig(workspaceDir: string): SeedConfig {
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

export function registerOnboardingRoutes(
  server: FastifyInstance,
  context: RouteContext
) {
  server.get("/api/onboarding/state", async () => {
    const secretsDir = path.join(context.workspaceDir, "state", "secrets");
    const apiKeyPath = path.join(secretsDir, "openai.json");
    const hasApiKey = fs.existsSync(apiKeyPath);
    const config = readSeedConfig(context.workspaceDir);
    const projects = context.db
      .prepare("SELECT name, type, root_path_rel FROM projects ORDER BY id")
      .all();

    return {
      hasApiKey,
      projects,
      activeProject: config.activeProject ?? null
    };
  });

  server.post(
    "/api/onboarding/api-key",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { provider?: string; apiKey?: string };
      const provider = body?.provider;
      const apiKey = body?.apiKey;

      if (!provider || !apiKey) {
        return reply.status(400).send({ ok: false, error: "Missing provider or apiKey" });
      }

      const secretsDir = path.join(context.workspaceDir, "state", "secrets");
      fs.mkdirSync(secretsDir, { recursive: true });
      const keyPath = path.join(secretsDir, `${provider}.json`);
      fs.writeFileSync(keyPath, JSON.stringify({ apiKey }, null, 2), {
        mode: 0o600
      });

      recordEvent(context.db, "onboarding.api_key_set", { provider });

      return { ok: true };
    }
  );
}
