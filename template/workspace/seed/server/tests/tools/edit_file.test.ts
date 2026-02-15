import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { createTempDir, removeDir, writeFile } from "../helpers/workspace.js";
import { editFile } from "../../src/kernel/tools/edit_file.js";

function sha256(text: string) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

test("edit_file anchor_replace updates content", async () => {
  const root = await createTempDir();
  try {
    await writeFile(root, "note.txt", "Header\nSTART\nold\nEND\nFooter\n");
    const allowedRootAbs = await fs.realpath(root);
    const before = await fs.readFile(`${root}/note.txt`, "utf8");
    const expectedSha256 = sha256(before.replace(/\r\n/g, "\n"));

    const result = await editFile({
      allowedRootAbs,
      path: "note.txt",
      expectedSha256,
      mode: "anchor_replace",
      before: { type: "text", value: "START\n" },
      after: { type: "text", value: "END\n" },
      replacement: "new\n",
      expectedOccurrences: 1
    });

    if (!result.ok) {
      assert.fail(JSON.stringify(result.error));
    }
    const updated = await fs.readFile(`${root}/note.txt`, "utf8");
    assert.ok(updated.includes("START\nnew\nEND\n"));
  } finally {
    await removeDir(root);
  }
});

test("edit_file anchor_replace with eof after replaces tail", async () => {
  const root = await createTempDir();
  try {
    await writeFile(root, "block.txt", "A\nBEGIN\nold\nEND\nB\n");
    const allowedRootAbs = await fs.realpath(root);
    const before = await fs.readFile(`${root}/block.txt`, "utf8");
    const expectedSha256 = sha256(before.replace(/\r\n/g, "\n"));

    const result = await editFile({
      allowedRootAbs,
      path: "block.txt",
      expectedSha256,
      mode: "anchor_replace",
      before: { type: "text", value: "END\n" },
      after: { type: "eof" },
      replacement: "TAIL\n",
      expectedOccurrences: 1
    });

    if (!result.ok) {
      assert.fail(JSON.stringify(result.error));
    }
    const updated = await fs.readFile(`${root}/block.txt`, "utf8");
    assert.ok(updated.endsWith("END\nTAIL\n"));
  } finally {
    await removeDir(root);
  }
});

test("edit_file insert_after inserts after anchor", async () => {
  const root = await createTempDir();
  try {
    await writeFile(root, "block.txt", "A\nANCHOR\nB\n");
    const allowedRootAbs = await fs.realpath(root);
    const before = await fs.readFile(`${root}/block.txt`, "utf8");
    const expectedSha256 = sha256(before.replace(/\r\n/g, "\n"));

    const result = await editFile({
      allowedRootAbs,
      path: "block.txt",
      expectedSha256,
      mode: "insert_after",
      anchor: { type: "text", value: "ANCHOR\n" },
      text: "INSERTED\n",
      expectedOccurrences: 1
    });

    assert.equal(result.ok, true);
    const updated = await fs.readFile(`${root}/block.txt`, "utf8");
    assert.ok(updated.includes("ANCHOR\nINSERTED\n"));
  } finally {
    await removeDir(root);
  }
});

test("edit_file append adds text to EOF", async () => {
  const root = await createTempDir();
  try {
    await writeFile(root, "note.txt", "hello\n");
    const allowedRootAbs = await fs.realpath(root);
    const before = await fs.readFile(`${root}/note.txt`, "utf8");
    const expectedSha256 = sha256(before.replace(/\r\n/g, "\n"));

    const result = await editFile({
      allowedRootAbs,
      path: "note.txt",
      expectedSha256,
      mode: "append",
      text: "tail"
    });

    assert.equal(result.ok, true);
    const updated = await fs.readFile(`${root}/note.txt`, "utf8");
    assert.ok(updated.endsWith("tail"));
  } finally {
    await removeDir(root);
  }
});

test("edit_file precondition failed when sha mismatch", async () => {
  const root = await createTempDir();
  try {
    await writeFile(root, "note.txt", "hello\n");
    const allowedRootAbs = await fs.realpath(root);

    const result = await editFile({
      allowedRootAbs,
      path: "note.txt",
      expectedSha256: "deadbeef",
      mode: "append",
      text: "hi\n"
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "PRECONDITION_FAILED");
    }
  } finally {
    await removeDir(root);
  }
});

test("edit_file ambiguous match when multiple occurrences", async () => {
  const root = await createTempDir();
  try {
    await writeFile(root, "note.txt", "X\nSTART\nA\nEND\nY\nSTART\nB\nEND\n");
    const allowedRootAbs = await fs.realpath(root);
    const before = await fs.readFile(`${root}/note.txt`, "utf8");
    const expectedSha256 = sha256(before.replace(/\r\n/g, "\n"));

    const result = await editFile({
      allowedRootAbs,
      path: "note.txt",
      expectedSha256,
      mode: "anchor_replace",
      before: { type: "text", value: "START\n" },
      after: { type: "text", value: "END\n" },
      replacement: "Z\n",
      expectedOccurrences: 1
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "AMBIGUOUS_MATCH");
    }
  } finally {
    await removeDir(root);
  }
});

test("edit_file overlapping anchors are rejected", async () => {
  const root = await createTempDir();
  try {
    await writeFile(root, "note.txt", "START\nA\nSTART\nB\nEND\nEND\n");
    const allowedRootAbs = await fs.realpath(root);
    const before = await fs.readFile(`${root}/note.txt`, "utf8");
    const expectedSha256 = sha256(before.replace(/\r\n/g, "\n"));

    const result = await editFile({
      allowedRootAbs,
      path: "note.txt",
      expectedSha256,
      mode: "anchor_replace",
      before: { type: "text", value: "START\n" },
      after: { type: "text", value: "END\n" },
      replacement: "X\n",
      expectedOccurrences: 2
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "OVERLAPPING_ANCHORS");
      assert.ok(result.error.details);
    }
  } finally {
    await removeDir(root);
  }
});
