import type Database from "better-sqlite3";

export function recordEvent(
  db: Database.Database,
  type: string,
  payload: Record<string, unknown>,
  projectId?: number
) {
  const stmt = db.prepare(
    "INSERT INTO events (ts, type, project_id, payload_json) VALUES (?, ?, ?, ?)"
  );
  stmt.run(new Date().toISOString(), type, projectId ?? null, JSON.stringify(payload));
}
