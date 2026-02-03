import Database from "better-sqlite3";
import path from "node:path";

export function openDb(workspaceDir: string): Database.Database {
  const dbPath = path.join(workspaceDir, "state", "seed.db");
  return new Database(dbPath);
}
