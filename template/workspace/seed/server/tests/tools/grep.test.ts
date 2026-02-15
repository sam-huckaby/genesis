import test from "node:test";
import assert from "node:assert/strict";
import { createTempDir, removeDir, requireRipgrep, writeFile } from "../helpers/workspace.js";
import { grep } from "../../src/kernel/tools/grep.js";

test("grep searches using ripgrep", async () => {
  requireRipgrep();

  const root = await createTempDir();
  try {
    await writeFile(root, "a.txt", "hello world\nsecond line\n");
    const result = await grep({ root, query: "hello" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.matches.length >= 1);
      assert.equal(result.matches[0]?.path, "a.txt");
    }
  } finally {
    await removeDir(root);
  }
});
