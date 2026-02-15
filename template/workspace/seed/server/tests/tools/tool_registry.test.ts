import test from "node:test";
import assert from "node:assert/strict";
import { getWorkspaceDir } from "../helpers/workspace.js";

test("tools DB is seeded and searchable", async () => {
  const workspaceDir = getWorkspaceDir();
  let openToolsDb: typeof import("../../src/storage/tools_db.js").openToolsDb;
  let searchToolsTool: typeof import("../../src/kernel/tools/search_tools.js").searchToolsTool;
  let describeTool: typeof import("../../src/kernel/tools/describe_tool.js").describeTool;

  try {
    ({ openToolsDb } = await import("../../src/storage/tools_db.js"));
    ({ searchToolsTool } = await import("../../src/kernel/tools/search_tools.js"));
    ({ describeTool } = await import("../../src/kernel/tools/describe_tool.js"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("better-sqlite3")) {
      throw new Error("Seed server deps missing. Run bun install in seed/server.");
    }
    throw error;
  }

  const db = openToolsDb(workspaceDir);
  const count = db.prepare("SELECT COUNT(*) as count FROM tools").get() as { count: number };
  assert.ok(count.count > 0);

  const search = await searchToolsTool(workspaceDir, { query: "read file" });
  assert.equal(search.ok, true);
  if (search.ok) {
    assert.ok(search.tools.length > 0);
  }

  const describe = await describeTool(workspaceDir, { name: "read_file" });
  assert.equal(describe.ok, true);
  if (describe.ok) {
    assert.equal(describe.name, "read_file");
    assert.ok(describe.argsSchema);
    assert.ok(describe.returnsSchema);
  }
});
