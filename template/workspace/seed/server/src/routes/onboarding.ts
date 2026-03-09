import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { recordEvent } from "../storage/events.js";
import {
  beginOpenAiOAuth,
  completeOpenAiOAuthFromManualInput,
  getOpenAiOAuthStatus,
  getOpenAiAuthSummary,
  saveOpenAiApiKey
} from "../kernel/openai_auth.js";
import {
  ensureWorkspaceNavUnlockState,
  markProjectNavItemSeen,
  markWorkspaceNavItemSeen,
  unlockWorkspaceNavFeature
} from "../util/nav_unlocks.js";
import type { NavSeenRequest } from "@shared/types";

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
    const openaiAuth = getOpenAiAuthSummary(context.workspaceDir);
    const hasApiKey = openaiAuth.mode !== null;
    const config = readSeedConfig(context.workspaceDir);
    const projects = context.db
      .prepare("SELECT name, type, root_path_rel FROM projects ORDER BY id")
      .all();
    const workspaceNav = ensureWorkspaceNavUnlockState(context.db, {
      hasAuth: hasApiKey,
      hasProjects: projects.length > 0
    });

    return {
      hasApiKey,
      openaiAuth,
      projects,
      activeProject: config.activeProject ?? null,
      workspaceNav
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
      if (provider !== "openai") {
        return reply.status(400).send({ ok: false, error: "Unsupported provider" });
      }
      saveOpenAiApiKey(context.workspaceDir, apiKey);
      unlockWorkspaceNavFeature(context.db, "discovery");

      recordEvent(context.db, "onboarding.api_key_set", { provider });

      return { ok: true };
    }
  );

  server.post(
    "/api/onboarding/openai/oauth/start",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { url } = await beginOpenAiOAuth(context.workspaceDir);
        return { ok: true, url };
      } catch (error) {
        return reply.status(400).send({
          ok: false,
          error: error instanceof Error ? error.message : "Failed to start OpenAI OAuth"
        });
      }
    }
  );

  server.get("/api/onboarding/openai/oauth/status", async () => {
    return getOpenAiOAuthStatus(context.workspaceDir);
  });

  server.post(
    "/api/onboarding/openai/oauth/manual",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { input?: string };
      try {
        await completeOpenAiOAuthFromManualInput(context.workspaceDir, body?.input ?? "");
        unlockWorkspaceNavFeature(context.db, "discovery");
        recordEvent(context.db, "onboarding.openai_oauth_set", { mode: "manual" });
        return { ok: true };
      } catch (error) {
        return reply.status(400).send({ ok: false, error: (error as Error).message });
      }
    }
  );

  server.post("/api/nav/seen", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as NavSeenRequest;
    if (!body?.realm || !body?.item) {
      return reply.status(400).send({ ok: false, error: "Missing realm or item" });
    }

    if (body.realm === "workspace") {
      if (body.item !== "discovery" && body.item !== "projects") {
        return reply.status(400).send({ ok: false, error: "Invalid workspace nav item" });
      }
      markWorkspaceNavItemSeen(context.db, body.item);
      return { ok: true };
    }

    if (body.realm === "project") {
      if (body.item !== "chat" && body.item !== "tasks" && body.item !== "review") {
        return reply.status(400).send({ ok: false, error: "Invalid project nav item" });
      }
      markProjectNavItemSeen(context.db, body.item);
      return { ok: true };
    }

    return reply.status(400).send({ ok: false, error: "Invalid realm" });
  });
}
