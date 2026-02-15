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
  if (!changesetNames.has("chat_session_id")) {
    db.exec("ALTER TABLE changesets ADD COLUMN chat_session_id TEXT");
  }

  const messageColumns = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  const messageNames = new Set(messageColumns.map((col) => col.name));
  if (!messageNames.has("kind")) {
    db.exec("ALTER TABLE messages ADD COLUMN kind TEXT");
  }
  if (!messageNames.has("status")) {
    db.exec("ALTER TABLE messages ADD COLUMN status TEXT");
  }
  if (!messageNames.has("tool_name")) {
    db.exec("ALTER TABLE messages ADD COLUMN tool_name TEXT");
  }
  if (!messageNames.has("tool_meta")) {
    db.exec("ALTER TABLE messages ADD COLUMN tool_meta TEXT");
  }
  if (!messageNames.has("conversation_id")) {
    db.exec("ALTER TABLE messages ADD COLUMN conversation_id INTEGER");
  }

  db.exec(
    "CREATE TABLE IF NOT EXISTS project_build_prompts (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, prompt_text TEXT NOT NULL, created_at TEXT NOT NULL)"
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS project_build_loops (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, max_iterations INTEGER NOT NULL, status TEXT NOT NULL, stop_reason TEXT, model TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS project_build_iterations (id INTEGER PRIMARY KEY AUTOINCREMENT, loop_id INTEGER NOT NULL, project_id INTEGER NOT NULL, iteration INTEGER NOT NULL, exit_code INTEGER NOT NULL, stdout TEXT NOT NULL, stderr TEXT NOT NULL, assistant_summary TEXT, created_at TEXT NOT NULL)"
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS project_chat_conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_message_at TEXT, last_viewed_at TEXT)"
  );

  db.exec(
    "CREATE TABLE IF NOT EXISTS changeset_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, changeset_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)"
  );

  db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const existingSetting = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("project_chat_max_iterations") as { value: string } | undefined;
  if (!existingSetting) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "project_chat_max_iterations",
      "100"
    );
  }
  db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(
    "100",
    "project_chat_max_iterations"
  );

  const loopModelSetting = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("build_loop_model") as { value: string } | undefined;
  if (!loopModelSetting) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "build_loop_model",
      "gpt-5.2"
    );
  }

  const needsBackfill = db
    .prepare("SELECT DISTINCT project_id FROM messages WHERE conversation_id IS NULL OR conversation_id = 0")
    .all() as { project_id: number }[];
  if (needsBackfill.length > 0) {
    const insertConversation = db.prepare(
      "INSERT INTO project_chat_conversations (project_id, title, created_at, updated_at, last_message_at, last_viewed_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const updateMessages = db.prepare(
      "UPDATE messages SET conversation_id = ? WHERE project_id = ? AND (conversation_id IS NULL OR conversation_id = 0)"
    );
    const firstMessageStmt = db.prepare(
      "SELECT content, created_at FROM messages WHERE project_id = ? ORDER BY id LIMIT 1"
    );
    const firstUserStmt = db.prepare(
      "SELECT content FROM messages WHERE project_id = ? AND role = 'user' ORDER BY id LIMIT 1"
    );
    const lastMessageStmt = db.prepare(
      "SELECT created_at FROM messages WHERE project_id = ? ORDER BY id DESC LIMIT 1"
    );

    const normalizeTitle = (input: string | null | undefined): string => {
      const base = (input ?? "").replace(/\s+/g, " ").trim();
      if (!base) {
        return "Conversation";
      }
      return base.length > 80 ? `${base.slice(0, 77)}...` : base;
    };

    for (const row of needsBackfill) {
      const firstMessage = firstMessageStmt.get(row.project_id) as
        | { content: string; created_at: string }
        | undefined;
      if (!firstMessage) {
        continue;
      }
      const firstUser = firstUserStmt.get(row.project_id) as { content: string } | undefined;
      const lastMessage = lastMessageStmt.get(row.project_id) as { created_at: string } | undefined;
      const title = normalizeTitle(firstUser?.content ?? firstMessage.content);
      const createdAt = firstMessage.created_at;
      const lastMessageAt = lastMessage?.created_at ?? createdAt;
      const updatedAt = lastMessageAt;
      const info = insertConversation.run(
        row.project_id,
        title,
        createdAt,
        updatedAt,
        lastMessageAt,
        lastMessageAt
      );
      const conversationId = Number(info.lastInsertRowid);
      updateMessages.run(conversationId, row.project_id);
    }
  }
}
