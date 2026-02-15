import test from "node:test";
import assert from "node:assert/strict";
import { buildToolMeta } from "../../src/kernel/project_chat_meta.js";

test("project_chat_meta formats apply_patch with type and path", () => {
  const meta = buildToolMeta({
    function: {
      name: "apply_patch",
      arguments: JSON.stringify({
        operations: [
          {
            type: "update_file",
            path: "next.config.ts"
          }
        ]
      })
    }
  });

  assert.equal(meta, "type=update_file path=next.config.ts");
});
