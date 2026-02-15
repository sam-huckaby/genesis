import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createTempRepo, removeDir, writeFile, gitCommit } from "../helpers/workspace.js";
import { applyUnifiedDiff } from "../../src/kernel/tools/apply_patch.js";

test("apply_patch applies diff and stages changes", async () => {
  const root = await createTempRepo();
  try {
    await writeFile(root, "a.txt", "one\n");
    gitCommit(root, "initial");

    await writeFile(root, "a.txt", "two\n");
    const diff = execFileSync("git", ["diff"], { cwd: root, encoding: "utf-8" });
    execFileSync("git", ["reset", "--hard"], { cwd: root, stdio: "ignore" });

    const allowedRootAbs = await fs.realpath(root);
    const result = await applyUnifiedDiff({ allowedRootAbs, patchText: diff });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.summary.filesChanged, 1);
      assert.equal(result.summary.files[0]?.path, "a.txt");
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

    const allowedRootAbs = await fs.realpath(root);
    const result = await applyUnifiedDiff({ allowedRootAbs, patchText: diff });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "DENYLIST_PATH");
    }
  } finally {
    await removeDir(root);
  }
});
