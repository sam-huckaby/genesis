import test from "node:test";
import assert from "node:assert/strict";
import { createGoAdapter } from "../../src/adapters/go.adapter.js";

test("go adapter scaffolds makefile for build and test", async () => {
  const adapter = createGoAdapter();
  const initResult = await adapter.init("projects/go-demo", {});

  assert.equal(initResult.runs.length, 0);
  assert.ok(initResult.postPatch);
  assert.equal(initResult.postPatch?.files.length, 1);
  assert.equal(initResult.postPatch?.files[0]?.pathRel, "projects/go-demo/Makefile");
  assert.ok(initResult.postPatch?.files[0]?.content.includes(".PHONY: build test"));
  assert.ok(initResult.postPatch?.files[0]?.content.includes("go build ./..."));
  assert.ok(initResult.postPatch?.files[0]?.content.includes("go test ./..."));
});

test("go adapter commands run make build and test", () => {
  const adapter = createGoAdapter();
  const commands = adapter.commands("projects/go-demo");

  assert.equal(commands.build?.cmd, "make");
  assert.deepEqual(commands.build?.args, ["build"]);
  assert.equal(commands.test?.cmd, "make");
  assert.deepEqual(commands.test?.args, ["test"]);
});

test("go adapter conventions use make commands", () => {
  const adapter = createGoAdapter();
  const conventions = adapter.conventions();

  assert.equal(conventions.commands.build, "make build");
  assert.equal(conventions.commands.test, "make test");
  assert.equal(conventions.layoutHints.cmd, "cmd/");
  assert.equal(conventions.layoutHints.internal, "internal/");
});
