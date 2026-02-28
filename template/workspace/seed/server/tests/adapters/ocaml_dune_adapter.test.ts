import test from "node:test";
import assert from "node:assert/strict";
import { createOcamlDuneAdapter } from "../../src/adapters/ocaml_dune.adapter.js";

test("ocaml adapter init produces dune runs and agent patch", async () => {
  const adapter = createOcamlDuneAdapter();
  const initResult = await adapter.init("projects/ocaml-demo", {});

  assert.equal(initResult.runs.length, 3);

  const [preflight, initRun, buildRun] = initResult.runs;
  assert.equal(preflight.cmd, "sh");
  assert.equal(preflight.args[0], "-c");
  assert.ok(preflight.args[1]?.includes("command -v dune"));
  assert.ok(preflight.args[1]?.includes("exec -- dune --version"));
  assert.ok(preflight.args[1]?.includes("OCaml adapter requires opam and dune."));

  assert.equal(initRun.cmd, "sh");
  assert.equal(initRun.args[0], "-c");
  assert.ok(initRun.args[1]?.includes("dune init proj ocaml-demo"));
  assert.ok(initRun.args[1]?.includes("exec -- dune"));

  assert.equal(buildRun.cmd, "sh");
  assert.equal(buildRun.args[0], "-c");
  assert.ok(buildRun.args[1]?.includes("dune build"));
  assert.ok(buildRun.args[1]?.includes("exec -- dune"));

  assert.ok(initResult.postPatch);
  assert.equal(initResult.postPatch?.files.length, 2);
  const makefilePatch = initResult.postPatch?.files.find((file) =>
    file.pathRel.endsWith("/Makefile")
  );
  const agentPatch = initResult.postPatch?.files.find((file) =>
    file.pathRel.endsWith("/AGENT.md")
  );
  assert.equal(makefilePatch?.pathRel, "projects/ocaml-demo/Makefile");
  assert.ok(makefilePatch?.content.includes(".PHONY: build test"));
  assert.ok(makefilePatch?.content.includes("dune build"));
  assert.ok(makefilePatch?.content.includes("opam 2>/dev/null"));
  assert.equal(agentPatch?.pathRel, "projects/ocaml-demo/AGENT.md");
  assert.ok(agentPatch?.content.includes("make build"));
  assert.ok(agentPatch?.content.includes("make test"));
});

test("ocaml adapter commands run make targets", () => {
  const adapter = createOcamlDuneAdapter();
  const commands = adapter.commands("projects/ocaml-demo");

  assert.ok(commands.build);
  assert.equal(commands.build?.cmd, "make");
  assert.equal(commands.build?.args[0], "build");

  assert.ok(commands.test);
  assert.equal(commands.test?.cmd, "make");
  assert.equal(commands.test?.args[0], "test");
});

test("ocaml adapter conventions describe dune", () => {
  const adapter = createOcamlDuneAdapter();
  const conventions = adapter.conventions();

  assert.equal(conventions.summary, "OCaml project initialized with dune.");
  assert.equal(conventions.commands.build, "make build");
  assert.equal(conventions.commands.test, "make test");
  assert.equal(conventions.layoutHints.lib, "lib/");
  assert.equal(conventions.layoutHints.bin, "bin/");
});
