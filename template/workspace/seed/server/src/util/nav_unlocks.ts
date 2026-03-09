import type Database from "better-sqlite3";

type ProjectNavFeature = "tasks" | "review";
type WorkspaceNavFeature = "discovery" | "projects";
type ProjectNavItem = "chat" | "tasks" | "review";
type WorkspaceNavItem = "discovery" | "projects";

function readSetting(db: Database.Database, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function writeSetting(db: Database.Database, key: string, value: string) {
  db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

function isEnabled(db: Database.Database, key: string): boolean {
  return readSetting(db, key) === "1";
}

function projectUnlockKey(feature: ProjectNavFeature, projectName: string): string {
  return `nav_unlock.${feature}.${projectName}`;
}

function workspaceUnlockKey(feature: WorkspaceNavFeature): string {
  return `nav_unlock.workspace.${feature}`;
}

function workspaceSeenKey(item: WorkspaceNavItem): string {
  return `nav_seen.workspace.${item}`;
}

function projectSeenKey(item: ProjectNavItem): string {
  return `nav_seen.project.${item}`;
}

export function unlockProjectNavFeature(
  db: Database.Database,
  projectName: string,
  feature: ProjectNavFeature
) {
  writeSetting(db, projectUnlockKey(feature, projectName), "1");
}

export function unlockWorkspaceNavFeature(db: Database.Database, feature: WorkspaceNavFeature) {
  writeSetting(db, workspaceUnlockKey(feature), "1");
}

export function markWorkspaceNavItemSeen(db: Database.Database, item: WorkspaceNavItem) {
  writeSetting(db, workspaceSeenKey(item), "1");
}

export function markProjectNavItemSeen(db: Database.Database, item: ProjectNavItem) {
  writeSetting(db, projectSeenKey(item), "1");
}

export function getWorkspaceNavState(db: Database.Database) {
  return {
    discoveryUnlocked: isEnabled(db, workspaceUnlockKey("discovery")),
    projectsUnlocked: isEnabled(db, workspaceUnlockKey("projects")),
    discoverySeen: isEnabled(db, workspaceSeenKey("discovery")),
    projectsSeen: isEnabled(db, workspaceSeenKey("projects"))
  };
}

export function ensureWorkspaceNavUnlockState(
  db: Database.Database,
  state: { hasAuth: boolean; hasProjects: boolean }
) {
  if (state.hasAuth) {
    unlockWorkspaceNavFeature(db, "discovery");
  }
  if (state.hasProjects) {
    unlockWorkspaceNavFeature(db, "projects");
  }
  return getWorkspaceNavState(db);
}

export function getProjectNavState(db: Database.Database, projectName: string) {
  return {
    tasksUnlocked: isEnabled(db, projectUnlockKey("tasks", projectName)),
    reviewUnlocked: isEnabled(db, projectUnlockKey("review", projectName)),
    chatSeen: isEnabled(db, projectSeenKey("chat")),
    tasksSeen: isEnabled(db, projectSeenKey("tasks")),
    reviewSeen: isEnabled(db, projectSeenKey("review"))
  };
}

export function ensureProjectNavUnlockState(
  db: Database.Database,
  project: { id: number; name: string }
) {
  const taskExists = db
    .prepare("SELECT 1 as exists_value FROM tasks WHERE project_id = ? LIMIT 1")
    .get(project.id) as { exists_value: number } | undefined;
  if (taskExists) {
    unlockProjectNavFeature(db, project.name, "tasks");
  }

  const reviewExists = db
    .prepare("SELECT 1 as exists_value FROM changesets WHERE project_id = ? LIMIT 1")
    .get(project.id) as { exists_value: number } | undefined;
  if (reviewExists) {
    unlockProjectNavFeature(db, project.name, "review");
  }

  return getProjectNavState(db, project.name);
}
