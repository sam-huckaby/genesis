import test from "node:test";
import assert from "node:assert/strict";
import { createNextJsAdapter } from "../../src/adapters/nextjs.adapter.js";

test("nextjs adapter scaffolds makefile and agent guidance", async () => {
  const adapter = createNextJsAdapter();
  const initResult = await adapter.init("projects/web-demo", {});

  assert.equal(initResult.runs.length, 2);
  assert.ok(initResult.postPatch);
  assert.equal(initResult.postPatch?.files.length, 2);

  const makefilePatch = initResult.postPatch?.files.find((file) =>
    file.pathRel.endsWith("/Makefile")
  );
  const agentPatch = initResult.postPatch?.files.find((file) =>
    file.pathRel.endsWith("/AGENT.md")
  );

  assert.equal(makefilePatch?.pathRel, "projects/web-demo/Makefile");
  assert.ok(makefilePatch?.content.includes(".PHONY: build test"));
  assert.ok(makefilePatch?.content.includes("bun run build"));
  assert.ok(makefilePatch?.content.includes("bun run lint"));

  assert.equal(agentPatch?.pathRel, "projects/web-demo/AGENT.md");
  assert.ok(agentPatch?.content.includes("make build"));
  assert.ok(agentPatch?.content.includes("make test"));
});

test("nextjs adapter commands run make build and test", () => {
  const adapter = createNextJsAdapter();
  const commands = adapter.commands("projects/web-demo");

  assert.equal(commands.build?.cmd, "make");
  assert.deepEqual(commands.build?.args, ["build"]);
  assert.equal(commands.test?.cmd, "make");
  assert.deepEqual(commands.test?.args, ["test"]);
  assert.equal(commands.lint?.cmd, "bun");
  assert.deepEqual(commands.lint?.args, ["lint"]);
});

test("nextjs adapter conventions use make commands", () => {
  const adapter = createNextJsAdapter();
  const conventions = adapter.conventions();

  assert.equal(conventions.commands.dev, "bun dev");
  assert.equal(conventions.commands.build, "make build");
  assert.equal(conventions.commands.test, "make test");
  assert.equal(conventions.commands.lint, "bun lint");
});
