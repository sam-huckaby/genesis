import path from "node:path";

export function resolveWorkspacePath(workspaceDir: string, relPath: string): string {
  const normalized = path.normalize(relPath);
  if (path.isAbsolute(normalized) || normalized.startsWith("..")) {
    throw new Error(`Path not allowed: ${relPath}`);
  }
  return path.join(workspaceDir, normalized);
}
