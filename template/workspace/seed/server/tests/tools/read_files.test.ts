import test from "node:test";
import assert from "node:assert/strict";
import { createTempDir, removeDir, writeFile } from "../helpers/workspace.js";
import { readFiles } from "../../src/kernel/tools/read_files.js";

test("read_files reads multiple files and enforces maxTotalBytes", async () => {
  const root = await createTempDir();
  try {
    await writeFile(root, "a.txt", "aaaaa");
    await writeFile(root, "b.txt", "bbbbb");

    const result = await readFiles({
      root,
      paths: ["a.txt", "b.txt"],
      maxBytesEach: 10,
      maxTotalBytes: 4
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      const a = result.files.find((file) => file.path === "a.txt");
      const b = result.files.find((file) => file.path === "b.txt");
      assert.ok(a?.content);
      assert.ok(b?.error);
      assert.equal(b?.error?.code, "TOO_LARGE");
    }
  } finally {
    await removeDir(root);
  }
});
