import path from "node:path";
import type Database from "better-sqlite3";
import { openToolsDb } from "../storage/tools_db.js";

export type ToolContract = {
  name: string;
  description: string;
  argsSchema: Record<string, unknown>;
  returnsSchema: Record<string, unknown>;
  tags: string[];
  examples: { input: unknown; output: unknown }[];
  filePath: string;
};

export type ToolSearchResult = {
  tools: ToolContract[];
  truncated: boolean;
};

export function searchTools(
  workspaceDir: string,
  query: string,
  topK = 8
): ToolSearchResult {
  const db = openToolsDb(workspaceDir);
  const toolNames = searchToolNames(db, query, topK);
  const tools = toolNames
    .map((name) => getToolContract(db, name))
    .filter(Boolean) as ToolContract[];
  return { tools, truncated: toolNames.length >= topK };
}

export function getToolContractByName(
  workspaceDir: string,
  name: string
): ToolContract | null {
  const db = openToolsDb(workspaceDir);
  return getToolContract(db, name);
}

export function resolveToolSourcePath(workspaceDir: string, name: string): string | null {
  const db = openToolsDb(workspaceDir);
  const row = db
    .prepare("SELECT file_path FROM tools WHERE name = ?")
    .get(name) as { file_path?: string } | undefined;
  if (!row?.file_path) {
    return null;
  }
  return path.join(workspaceDir, row.file_path);
}

function searchToolNames(db: Database.Database, query: string, topK: number): string[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const rows = db
    .prepare(
      "SELECT name FROM tool_search WHERE tool_search MATCH ? ORDER BY bm25(tool_search) LIMIT ?"
    )
    .all(trimmed, topK) as { name: string }[];
  return rows.map((row) => row.name);
}

function getToolContract(db: Database.Database, name: string): ToolContract | null {
  const tool = db
    .prepare(
      "SELECT name, description, args_schema_json, returns_schema_json, tags_json, examples_json, file_path FROM tools WHERE name = ?"
    )
    .get(name) as
    | {
        name: string;
        description: string;
        args_schema_json: string;
        returns_schema_json: string;
        tags_json: string;
        examples_json: string;
        file_path: string;
      }
    | undefined;
  if (!tool) {
    return null;
  }

  return {
    name: tool.name,
    description: tool.description,
    argsSchema: JSON.parse(tool.args_schema_json) as Record<string, unknown>,
    returnsSchema: JSON.parse(tool.returns_schema_json) as Record<string, unknown>,
    tags: JSON.parse(tool.tags_json) as string[],
    examples: JSON.parse(tool.examples_json) as { input: unknown; output: unknown }[],
    filePath: tool.file_path
  };
}
