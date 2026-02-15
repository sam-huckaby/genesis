import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createTempDir, removeDir, writeFile } from "../helpers/workspace.js";
import { applyPatchTool } from "../../src/kernel/tools/apply_patch_tool.js";

test("apply_patch create_file creates file from diff", async () => {
  const root = await createTempDir();
  try {
    const allowedRootAbs = await fs.realpath(root);
    const result = await applyPatchTool({
      allowedRootAbs,
      operations: [
        {
          type: "create_file",
          path: "new.txt",
          diff: "@@\n+hello\n+world\n"
        }
      ]
    });

    assert.equal(result.ok, true);
    const content = await fs.readFile(`${root}/new.txt`, "utf8");
    assert.equal(content, "hello\nworld");
  } finally {
    await removeDir(root);
  }
});

test("apply_patch update_file updates content from diff", async () => {
  const root = await createTempDir();
  try {
    await writeFile(root, "note.txt", "one\n");
    const allowedRootAbs = await fs.realpath(root);
    const result = await applyPatchTool({
      allowedRootAbs,
      operations: [
        {
          type: "update_file",
          path: "note.txt",
          diff: "@@\n-one\n+two\n \n"
        }
      ]
    });

    assert.equal(result.ok, true);
    const content = await fs.readFile(`${root}/note.txt`, "utf8");
    assert.equal(content, "two\n");
  } finally {
    await removeDir(root);
  }
});

test("apply_patch delete_file removes file", async () => {
  const root = await createTempDir();
  try {
    await writeFile(root, "gone.txt", "bye\n");
    const allowedRootAbs = await fs.realpath(root);
    const result = await applyPatchTool({
      allowedRootAbs,
      operations: [
        {
          type: "delete_file",
          path: "gone.txt"
        }
      ]
    });

    assert.equal(result.ok, true);
    const exists = await fs
      .stat(`${root}/gone.txt`)
      .then(() => true)
      .catch(() => false);
    assert.equal(exists, false);
  } finally {
    await removeDir(root);
  }
});

test("apply_patch rejects malformed diff", async () => {
  const root = await createTempDir();
  try {
    await writeFile(root, "bad.txt", "one\n");
    const allowedRootAbs = await fs.realpath(root);
    const result = await applyPatchTool({
      allowedRootAbs,
      operations: [
        {
          type: "update_file",
          path: "bad.txt",
          diff: "INVALID"
        }
      ]
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "MALFORMED_DIFF");
    }
  } finally {
    await removeDir(root);
  }
});

test("apply_patch rejects denied paths", async () => {
  const root = await createTempDir();
  try {
    const allowedRootAbs = await fs.realpath(root);
    const result = await applyPatchTool({
      allowedRootAbs,
      operations: [
        {
          type: "create_file",
          path: ".env",
          diff: "@@\n+SECRET=1\n"
        }
      ]
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "DENYLIST_PATH");
    }
  } finally {
    await removeDir(root);
  }
});
