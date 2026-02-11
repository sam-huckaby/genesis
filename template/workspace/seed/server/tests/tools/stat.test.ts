import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createTempDir, removeDir, writeFile } from "../helpers/workspace.js";
import { statPath } from "../../src/kernel/tools/stat.js";

test("stat returns correct types", async () => {
  const root = await createTempDir();
  try {
    await writeFile(root, "file.txt", "hello");
    await fs.mkdir(path.join(root, "dir"));
    await fs.symlink(path.join(root, "file.txt"), path.join(root, "link.txt"));

    const fileRes = await statPath({ root, path: "file.txt" });
    const dirRes = await statPath({ root, path: "dir" });
    const linkRes = await statPath({ root, path: "link.txt" });

    assert.equal(fileRes.ok, true);
    assert.equal(dirRes.ok, true);
    assert.equal(linkRes.ok, true);

    if (fileRes.ok && dirRes.ok && linkRes.ok) {
      assert.equal(fileRes.result.type, "file");
      assert.equal(dirRes.result.type, "dir");
      assert.equal(linkRes.result.type, "symlink");
    }
  } finally {
    await removeDir(root);
  }
});
