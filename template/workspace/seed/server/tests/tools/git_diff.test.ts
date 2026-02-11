import test from "node:test";
import assert from "node:assert/strict";
import { createTempRepo, removeDir, writeFile, gitCommit } from "../helpers/workspace.js";
import { gitDiff } from "../../src/kernel/tools/git_diff.js";

test("git_diff returns staged diff", async () => {
  const root = await createTempRepo();
  try {
    await writeFile(root, "a.txt", "one\n");
    gitCommit(root, "initial");

    await writeFile(root, "a.txt", "two\n");
    const diff = await gitDiff({ root });
    assert.equal(diff.ok, true);
    if (diff.ok) {
      assert.ok(diff.result.diff.includes("two"));
    }
  } finally {
    await removeDir(root);
  }
});
