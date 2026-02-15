import test from "node:test";
import assert from "node:assert/strict";
import { createTempDir, removeDir, writeFile } from "../helpers/workspace.js";
import { readFileTool } from "../../src/kernel/tools/read_file.js";

test("read_file reads file and supports range", async () => {
  const root = await createTempDir();
  try {
    await writeFile(root, "note.txt", "line1\nline2\nline3\n");

    const result = await readFileTool({
      root,
      path: "note.txt",
      range: { startLine: 2, endLine: 2 }
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.content, "line2");
      assert.equal(result.truncated, false);
    }
  } finally {
    await removeDir(root);
  }
});

test("read_file truncates by maxBytes", async () => {
  const root = await createTempDir();
  try {
    await writeFile(root, "big.txt", "0123456789");
    const result = await readFileTool({ root, path: "big.txt", maxBytes: 5 });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.content, "01234");
      assert.equal(result.truncated, true);
    }
  } finally {
    await removeDir(root);
  }
});
