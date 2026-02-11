import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createTempRepo, removeDir, writeFile, gitCommit } from "../helpers/workspace.js";
import { applyPatch } from "../../src/kernel/tools/apply_patch.js";

test("apply_patch applies diff and stages changes", async () => {
  const root = await createTempRepo();
  try {
    await writeFile(root, "a.txt", "one\n");
    gitCommit(root, "initial");

    await writeFile(root, "a.txt", "two\n");
    const diff = execFileSync("git", ["diff"], { cwd: root, encoding: "utf-8" });
    execFileSync("git", ["reset", "--hard"], { cwd: root, stdio: "ignore" });

    const result = await applyPatch({ root, unifiedDiff: diff });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.result.applied, true);
      assert.ok(result.result.filesChanged.includes("a.txt"));
    }
  } finally {
    await removeDir(root);
  }
});

test("apply_patch rejects denied paths", async () => {
  const root = await createTempRepo();
  try {
    await writeFile(root, ".env", "SECRET=1\n");
    gitCommit(root, "add env");
    await writeFile(root, ".env", "SECRET=2\n");
    const diff = execFileSync("git", ["diff"], { cwd: root, encoding: "utf-8" });
    execFileSync("git", ["reset", "--hard"], { cwd: root, stdio: "ignore" });

    const result = await applyPatch({ root, unifiedDiff: diff });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "NOT_ALLOWED");
    }
  } finally {
    await removeDir(root);
  }
});
