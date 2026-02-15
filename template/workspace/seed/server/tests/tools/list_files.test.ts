import test from "node:test";
import assert from "node:assert/strict";
import { createTempDir, removeDir, writeFile } from "../helpers/workspace.js";
import { listFiles } from "../../src/kernel/tools/list_files.js";

test("list_files lists files and respects maxDepth", async () => {
  const root = await createTempDir();
  try {
    await writeFile(root, "a/file.txt", "hello");
    await writeFile(root, "a/b/deep.txt", "deep");

    const result = await listFiles({ root, maxDepth: 1, maxResults: 50 });
    assert.equal(result.ok, true);
    if (result.ok) {
      const paths = result.entries.map((entry) => entry.path);
      assert.ok(paths.includes("a/file.txt"));
      assert.ok(!paths.includes("a/b/deep.txt"));
    }
  } finally {
    await removeDir(root);
  }
});

test("list_files includes dirs when includeDirs=true", async () => {
  const root = await createTempDir();
  try {
    await writeFile(root, "dir/file.txt", "hello");

    const result = await listFiles({ root, includeDirs: true, maxResults: 50 });
    assert.equal(result.ok, true);
    if (result.ok) {
      const dirEntry = result.entries.find((entry) => entry.path === "dir");
      assert.ok(dirEntry);
      assert.equal(dirEntry?.type, "dir");
    }
  } finally {
    await removeDir(root);
  }
});
