import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(server: FastifyInstance) {
  server.get("/api/health", async () => {
    return { ok: true, version: "0.0.1" };
  });
}
