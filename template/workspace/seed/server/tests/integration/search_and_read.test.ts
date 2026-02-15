import test from "node:test";
import assert from "node:assert/strict";
import { createTempDir, removeDir, requireRipgrep, writeFile } from "../helpers/workspace.js";
import { listFiles } from "../../src/kernel/tools/list_files.js";
import { grep } from "../../src/kernel/tools/grep.js";
import { readFiles } from "../../src/kernel/tools/read_files.js";

test("integration: list_files -> grep -> read_files", async () => {
  requireRipgrep();
  const root = await createTempDir();
  try {
    await writeFile(root, "src/a.txt", "hello from a\n");
    await writeFile(root, "src/b.txt", "hello from b\n");

    const listed = await listFiles({ root, globs: ["src/**/*.txt"], maxResults: 10 });
    assert.equal(listed.ok, true);
    if (!listed.ok) {
      return;
    }

    const match = await grep({ root, query: "hello" });
    assert.equal(match.ok, true);
    if (!match.ok) {
      return;
    }

    const paths = listed.entries.map((entry) => entry.path);
    const read = await readFiles({ root, paths });
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.equal(read.files.length, paths.length);
    }
  } finally {
    await removeDir(root);
  }
});
