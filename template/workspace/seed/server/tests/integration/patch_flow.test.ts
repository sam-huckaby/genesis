import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createTempRepo, removeDir, writeFile, gitCommit } from "../helpers/workspace.js";
import { applyUnifiedDiff } from "../../src/kernel/tools/apply_patch.js";
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

    const allowedRootAbs = await fs.realpath(root);
    const applied = await applyUnifiedDiff({ allowedRootAbs, patchText: diff });
    assert.equal(applied.ok, true);

    const status = await gitStatus({ root });
    assert.equal(status.ok, true);
    if (status.ok) {
      assert.equal(status.isClean, false);
    }

    const workingDiff = await gitDiff({ root, staged: false });
    assert.equal(workingDiff.ok, true);
    if (workingDiff.ok) {
      assert.ok(workingDiff.diff.includes("two"));
    }
  } finally {
    await removeDir(root);
  }
});
