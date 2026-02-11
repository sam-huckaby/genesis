import test from "node:test";
import assert from "node:assert/strict";
import { createTempDir, removeDir, writeFile } from "../helpers/workspace.js";
import { projectInfo } from "../../src/kernel/tools/project_info.js";

test("project_info detects framework and language", async () => {
  const root = await createTempDir();
  try {
    await writeFile(
      root,
      "package.json",
      JSON.stringify(
        {
          dependencies: { react: "^18.0.0" },
          devDependencies: { typescript: "^5.0.0" }
        },
        null,
        2
      )
    );
    await writeFile(root, "tsconfig.json", "{}\n");

    const result = await projectInfo({ root });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.result.frameworks.includes("react"));
      assert.ok(result.result.languages.includes("ts"));
      assert.ok(result.result.keyFiles.includes("package.json"));
    }
  } finally {
    await removeDir(root);
  }
});
