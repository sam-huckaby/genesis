CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  root_path_rel TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  parent_task_id INTEGER,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  project_id INTEGER,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discoveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  summary TEXT,
  recommended_type TEXT,
  alternatives_json TEXT,
  draft_brief TEXT,
  suggested_name TEXT
);

CREATE TABLE IF NOT EXISTS discovery_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discovery_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_briefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  brief_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_build_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  prompt_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  kind TEXT,
  status TEXT,
  tool_name TEXT,
  tool_meta TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  snippet TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS changesets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  base_revision TEXT NOT NULL,
  stash_ref TEXT,
  thread_id TEXT,
  chat_session_id TEXT,
  parent_id INTEGER,
  close_reason TEXT,
  commit_hash TEXT,
  project_commit_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS changeset_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  changeset_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  diff_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS changeset_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  changeset_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
