import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createTempRepo, removeDir, writeFile, gitCommit } from "../helpers/workspace.js";
import { applyPatch } from "../../src/kernel/tools/apply_patch.js";
import { gitStatus } from "../../src/kernel/tools/git_status.js";
import { gitDiff } from "../../src/kernel/tools/git_diff.js";

test("integration: apply_patch -> git_diff -> git_status", async () => {
  const root = await createTempRepo();
  try {
    await writeFile(root, "a.txt", "one\n");
    gitCommit(root, "initial");

    await writeFile(root, "a.txt", "two\n");
    const diff = execFileSync("git", ["diff"], { cwd: root, encoding: "utf-8" });
    execFileSync("git", ["reset", "--hard"], { cwd: root, stdio: "ignore" });

    const applied = await applyPatch({ root, unifiedDiff: diff });
    assert.equal(applied.ok, true);

    const status = await gitStatus({ root });
    assert.equal(status.ok, true);
    if (status.ok) {
      assert.equal(status.result.isClean, false);
    }

    const stagedDiff = await gitDiff({ root, staged: true });
    assert.equal(stagedDiff.ok, true);
    if (stagedDiff.ok) {
      assert.ok(stagedDiff.result.diff.includes("two"));
    }
  } finally {
    await removeDir(root);
  }
});
