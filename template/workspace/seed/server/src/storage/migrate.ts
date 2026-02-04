import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database, baseDir: string) {
  const schemaPath = path.join(baseDir, "storage", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  db.exec(sql);

  const columns = db.prepare("PRAGMA table_info(discoveries)").all() as { name: string }[];
  const columnNames = new Set(columns.map((col) => col.name));
  if (!columnNames.has("draft_brief")) {
    db.exec("ALTER TABLE discoveries ADD COLUMN draft_brief TEXT");
  }
  if (!columnNames.has("suggested_name")) {
    db.exec("ALTER TABLE discoveries ADD COLUMN suggested_name TEXT");
  }

  const changesetColumns = db
    .prepare("PRAGMA table_info(changesets)")
    .all() as { name: string }[];
  const changesetNames = new Set(changesetColumns.map((col) => col.name));
  if (!changesetNames.has("project_commit_hash")) {
    db.exec("ALTER TABLE changesets ADD COLUMN project_commit_hash TEXT");
  }
  if (!changesetNames.has("stash_ref")) {
    db.exec("ALTER TABLE changesets ADD COLUMN stash_ref TEXT");
  }
  if (!changesetNames.has("thread_id")) {
    db.exec("ALTER TABLE changesets ADD COLUMN thread_id TEXT");
  }
  if (!changesetNames.has("parent_id")) {
    db.exec("ALTER TABLE changesets ADD COLUMN parent_id INTEGER");
  }
  if (!changesetNames.has("close_reason")) {
    db.exec("ALTER TABLE changesets ADD COLUMN close_reason TEXT");
  }

  db.exec(
    "CREATE TABLE IF NOT EXISTS changeset_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, changeset_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)"
  );
}
