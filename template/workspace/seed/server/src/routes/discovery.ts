import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { recordEvent } from "../storage/events.js";
import { runDiscoveryLlm } from "../kernel/llm.js";
import type {
  DiscoveryCompleteRequest,
  DiscoveryMessageRequest,
  DiscoveryMessageResponse,
  DiscoveryStartResponse
} from "@shared/types";

type RouteContext = {
  workspaceDir: string;
  db: Database.Database;
};

const allowedTypes = new Set(["nextjs", "go_service", "ocaml_dune"]);

function normalizeLlmResponse(input: {
  status: string;
  assistantMessage: unknown;
  recommendation: { recommended?: unknown; alternatives?: unknown };
  draftBrief?: unknown;
  suggestedName?: unknown;
}): {
  status: "ready" | "needs_more_info";
  assistantMessage: string;
  recommendation: {
    recommended: "nextjs" | "go_service" | "ocaml_dune";
    alternatives: { type: "nextjs" | "go_service" | "ocaml_dune"; why: string[] }[];
  };
  draftBrief: string;
  suggestedName: string;
} {
  const recommended =
    typeof input.recommendation?.recommended === "string" &&
    allowedTypes.has(input.recommendation.recommended)
      ? (input.recommendation.recommended as "nextjs" | "go_service" | "ocaml_dune")
      : "nextjs";

  const alternatives = Array.isArray(input.recommendation?.alternatives)
    ? (input.recommendation.alternatives as { type: string; why: string[] }[])
        .filter((alt) => allowedTypes.has(alt.type))
        .map((alt) => ({
          type: alt.type as "nextjs" | "go_service" | "ocaml_dune",
          why: Array.isArray(alt.why) ? alt.why : []
        }))
    : [];

  return {
    status: input.status === "ready" ? "ready" : "needs_more_info",
    assistantMessage:
      typeof input.assistantMessage === "string" ? input.assistantMessage : "",
    recommendation: {
      recommended,
      alternatives
    },
    draftBrief: typeof input.draftBrief === "string" ? input.draftBrief : "",
    suggestedName: typeof input.suggestedName === "string" ? input.suggestedName : ""
  };
}

type StartResponse = DiscoveryStartResponse;

export function registerDiscoveryRoutes(
  server: FastifyInstance,
  context: RouteContext
) {
  server.post(
    "/api/discovery/start",
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const stmt = context.db.prepare(
        "INSERT INTO discoveries (created_at, summary, recommended_type, alternatives_json, draft_brief, suggested_name) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const info = stmt.run(new Date().toISOString(), null, null, null, null, null);
      const discoveryId = Number(info.lastInsertRowid);

      recordEvent(context.db, "discovery.started", { discoveryId });

      const response: StartResponse = { discoveryId };
      return response;
    }
  );

  server.post(
    "/api/discovery/message",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as DiscoveryMessageRequest;

      if (!body?.discoveryId || !body?.role || !body?.content) {
        return reply.status(400).send({ ok: false, error: "Missing fields" });
      }

      const stmt = context.db.prepare(
        "INSERT INTO discovery_messages (discovery_id, role, content, created_at) VALUES (?, ?, ?, ?)"
      );
      stmt.run(body.discoveryId, body.role, body.content, new Date().toISOString());

      const secretsPath = path.join(context.workspaceDir, "state", "secrets", "openai.json");
      if (!fs.existsSync(secretsPath)) {
        return reply.status(400).send({ ok: false, error: "Missing OpenAI API key" });
      }
      const apiKey = JSON.parse(fs.readFileSync(secretsPath, "utf8")).apiKey as string;

      const transcript = context.db
        .prepare(
          "SELECT role, content FROM discovery_messages WHERE discovery_id = ? ORDER BY id"
        )
        .all(body.discoveryId) as { role: "user" | "assistant"; content: string }[];

      const llmResult = await runDiscoveryLlm(apiKey, transcript);
      const llmResponse = normalizeLlmResponse(llmResult.parsed);

      const logDir = path.join(context.workspaceDir, "state", "logs");
      fs.mkdirSync(logDir, { recursive: true });
      const logPath = path.join(logDir, "llm-debug.log");
      fs.appendFileSync(
        logPath,
        `[${new Date().toISOString()}] ${llmResult.raw}\n\n`
      );

      const assistantStmt = context.db.prepare(
        "INSERT INTO discovery_messages (discovery_id, role, content, created_at) VALUES (?, ?, ?, ?)"
      );
      assistantStmt.run(
        body.discoveryId,
        "assistant",
        llmResponse.assistantMessage,
        new Date().toISOString()
      );

      if (llmResponse.status === "ready") {
        const update = context.db.prepare(
          "UPDATE discoveries SET summary = ?, recommended_type = ?, alternatives_json = ?, draft_brief = ?, suggested_name = ? WHERE id = ?"
        );
        update.run(
          llmResponse.draftBrief.slice(0, 200) || null,
          llmResponse.recommendation.recommended ?? null,
          JSON.stringify(llmResponse.recommendation.alternatives ?? []),
          llmResponse.draftBrief || null,
          llmResponse.suggestedName || null,
          body.discoveryId
        );
        recordEvent(context.db, "discovery.ready", { discoveryId: body.discoveryId });
      }

      const response: DiscoveryMessageResponse = {
        status: llmResponse.status,
        assistantMessage: llmResponse.assistantMessage,
        recommendation: llmResponse.recommendation,
        draftBrief: llmResponse.draftBrief,
        suggestedName: llmResponse.suggestedName
      };

      return response;
    }
  );

  server.post(
    "/api/discovery/complete",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as DiscoveryCompleteRequest;

      if (!body?.discoveryId) {
        return reply.status(400).send({ ok: false, error: "Missing discoveryId" });
      }

      const stmt = context.db.prepare(
        "UPDATE discoveries SET summary = ?, recommended_type = ?, alternatives_json = ?, draft_brief = ?, suggested_name = ? WHERE id = ?"
      );
      stmt.run(
        body.summary ?? null,
        body.recommendedType ?? null,
        JSON.stringify(body.alternatives ?? []),
        body.draftBrief ?? null,
        body.suggestedName ?? null,
        body.discoveryId
      );

      recordEvent(context.db, "discovery.completed", { discoveryId: body.discoveryId });

      return { ok: true };
    }
  );
}
