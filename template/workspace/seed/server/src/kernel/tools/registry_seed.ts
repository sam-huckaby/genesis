import type Database from "better-sqlite3";
import { TOOL_SPECS } from "./tool_specs.js";

// Populate the tools registry tables from in-code tool specs.
export function seedToolsDb(db: Database.Database) {
  // Clear existing rows to keep the registry in sync with code.
  db.prepare("DELETE FROM tools").run();
  db.prepare("DELETE FROM tool_search").run();

  const insertTool = db.prepare(
    "INSERT INTO tools (name, description, args_schema_json, returns_schema_json, examples_json, tags_json, file_path) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insertSearch = db.prepare(
    "INSERT INTO tool_search (name, description, tags, examples) VALUES (?, ?, ?, ?)"
  );

  for (const spec of TOOL_SPECS) {
    // Normalize optional fields to keep JSON payloads consistent.
    const tags = spec.tags ?? [];
    const examples = spec.examples ?? [];
    insertTool.run(
      spec.name,
      spec.description,
      JSON.stringify(spec.argsSchema),
      JSON.stringify(spec.returnsSchema),
      JSON.stringify(examples),
      JSON.stringify(tags),
      spec.filePath
    );
    insertSearch.run(spec.name, spec.description, tags.join(" "), JSON.stringify(examples));
  }
}
