import type Database from "better-sqlite3";
import { TOOL_SPECS } from "./tool_specs.js";

export function seedToolsDb(db: Database.Database) {
  db.prepare("DELETE FROM tools").run();
  db.prepare("DELETE FROM tool_search").run();

  const insertTool = db.prepare(
    "INSERT INTO tools (name, description, args_schema_json, returns_schema_json, examples_json, tags_json, file_path) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insertSearch = db.prepare(
    "INSERT INTO tool_search (name, description, tags, examples) VALUES (?, ?, ?, ?)"
  );

  for (const spec of TOOL_SPECS) {
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
