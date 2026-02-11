PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS tools (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  args_schema_json TEXT NOT NULL,
  returns_schema_json TEXT NOT NULL,
  examples_json TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  file_path TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS tool_search USING fts5(
  name,
  description,
  tags,
  examples,
  tokenize = 'porter'
);
