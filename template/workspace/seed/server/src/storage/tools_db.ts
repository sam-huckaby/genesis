import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { seedToolsDb } from "../kernel/tools/registry_seed.js";
import { TOOL_SPECS } from "../kernel/tools/tool_specs.js";

let cachedDb: Database.Database | null = null;
let cachedPath: string | null = null;

export function openToolsDb(workspaceDir: string): Database.Database {
  const dbPath = path.join(workspaceDir, "seed", "server", "tools.db");
  if (cachedDb && cachedPath === dbPath) {
    return cachedDb;
  }
  let db = new Database(dbPath);
  const recreated = ensureToolsSchema(db, workspaceDir, dbPath);
  if (recreated) {
    db = new Database(dbPath);
  }
  ensureSeeded(db);
  cachedDb = db;
  cachedPath = dbPath;
  return db;
}

function ensureToolsSchema(db: Database.Database, workspaceDir: string, dbPath: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tools'")
    .get() as { name?: string } | undefined;
  if (row?.name === "tools") {
    const cols = db.prepare("PRAGMA table_info(tools)").all() as { name: string }[];
    const colNames = new Set(cols.map((col) => col.name));
    if (colNames.has("args_schema_json") && colNames.has("returns_schema_json")) {
      return false;
    }
  }

  db.close();
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  const fresh = new Database(dbPath);
  const schemaPath = path.join(workspaceDir, "seed", "server", "src", "storage", "tools_schema.sql");
  if (!fs.existsSync(schemaPath)) {
    throw new Error("tools_schema.sql not found");
  }
  const sql = fs.readFileSync(schemaPath, "utf8");
  fresh.exec(sql);
  fresh.close();
  return true;
}

function ensureSeeded(db: Database.Database) {
  const row = db
    .prepare("SELECT COUNT(*) as count FROM tools")
    .get() as { count: number } | undefined;
  const expectedCount = TOOL_SPECS.length;
  if (!row || row.count !== expectedCount) {
    seedToolsDb(db);
    return;
  }
  const existing = db
    .prepare("SELECT name FROM tools")
    .all() as { name: string }[];
  const existingNames = new Set(existing.map((tool) => tool.name));
  const missing = TOOL_SPECS.some((spec) => !existingNames.has(spec.name));
  if (missing) {
    seedToolsDb(db);
  }
}
