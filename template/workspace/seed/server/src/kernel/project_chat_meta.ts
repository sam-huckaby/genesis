// Utility helpers for compact tool-call metadata (used in UI/logs).
type ToolCall = {
  function: { name: string; arguments: string };
};

function normalizeToolName(name: string): string {
  return name.replace(/^functions\./, "");
}

export function buildToolMeta(call: ToolCall): string {
  // Keep metadata short and human-readable for quick inspection.
  const toolName = normalizeToolName(call.function.name);
  let args: Record<string, unknown> = {};
  try {
    args = call.function.arguments
      ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
      : {};
  } catch {
    return toolName;
  }

  if (toolName === "read_file" || toolName === "stat") {
    const pathArg = typeof args.path === "string" ? args.path : "";
    return pathArg ? `path=${pathArg}` : "path=?";
  }
  if (toolName === "read_files") {
    const paths = Array.isArray(args.paths) ? args.paths.length : 0;
    return paths > 0 ? `paths=${paths}` : "paths=?";
  }
  if (toolName === "list_files") {
    const root = typeof args.root === "string" ? args.root : "";
    return root ? `root=${root}` : "root=?";
  }
  if (toolName === "grep") {
    const query = typeof args.query === "string" ? args.query : "";
    return query ? `query=${query}` : "query=?";
  }
  if (toolName === "search_tools") {
    const query = typeof args.query === "string" ? args.query : "";
    return query ? `query=${query}` : "query=?";
  }
  if (toolName === "edit_file") {
    const filePath = typeof args.path === "string" ? args.path : "";
    return filePath ? `path=${filePath}` : "path=?";
  }
  if (toolName === "apply_patch") {
    const operations = Array.isArray(args.operations)
      ? (args.operations as Array<{ type?: string; path?: string }>)
      : [];
    if (operations.length === 1) {
      const type = operations[0]?.type ?? "?";
      const path = operations[0]?.path ?? "?";
      return `type=${type} path=${path}`;
    }
    return `ops=${operations.length}`;
  }
  if (toolName === "apply_unified_diff") {
    return "apply_unified_diff";
  }
  return toolName;
}
