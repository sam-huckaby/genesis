import test from "node:test";
import assert from "node:assert/strict";
import { createTempRepo, removeDir, writeFile, gitCommit } from "../helpers/workspace.js";
import { gitStatus } from "../../src/kernel/tools/git_status.js";

test("git_status reports clean and dirty states", async () => {
  const root = await createTempRepo();
  try {
    await writeFile(root, "a.txt", "one\n");
    gitCommit(root, "initial");

    const clean = await gitStatus({ root });
    assert.equal(clean.ok, true);
    if (clean.ok) {
      assert.equal(clean.isClean, true);
    }

    await writeFile(root, "a.txt", "two\n");
    const dirty = await gitStatus({ root });
    assert.equal(dirty.ok, true);
    if (dirty.ok) {
      assert.equal(dirty.isClean, false);
      assert.ok(dirty.changes.length > 0);
    }
  } finally {
    await removeDir(root);
  }
});
