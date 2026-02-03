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
}
