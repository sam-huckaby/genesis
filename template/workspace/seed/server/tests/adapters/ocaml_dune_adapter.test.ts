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
  assert.ok(preflight.args[1]?.includes("opam exec -- dune --version"));
  assert.ok(
    preflight.args[1]?.includes(
      "OCaml adapter requires opam and dune. Install opam, run \"opam install dune\", or choose another scaffold."
    )
  );

  assert.equal(initRun.cmd, "sh");
  assert.equal(initRun.args[0], "-c");
  assert.ok(initRun.args[1]?.includes("dune init proj ocaml-demo"));
  assert.ok(initRun.args[1]?.includes("opam exec -- dune"));

  assert.equal(buildRun.cmd, "sh");
  assert.equal(buildRun.args[0], "-c");
  assert.ok(buildRun.args[1]?.includes("dune build"));
  assert.ok(buildRun.args[1]?.includes("opam exec -- dune"));

  assert.ok(initResult.postPatch);
  assert.equal(initResult.postPatch?.files.length, 1);
  assert.equal(initResult.postPatch?.files[0]?.pathRel, "projects/ocaml-demo/AGENT.md");
  assert.ok(initResult.postPatch?.files[0]?.content.includes("dune build"));
  assert.ok(initResult.postPatch?.files[0]?.content.includes("dune test"));
});

test("ocaml adapter commands use opam exec", () => {
  const adapter = createOcamlDuneAdapter();
  const commands = adapter.commands("projects/ocaml-demo");

  assert.ok(commands.build);
  assert.equal(commands.build?.cmd, "sh");
  assert.equal(commands.build?.args[0], "-c");
  assert.ok(commands.build?.args[1]?.includes("opam exec -- dune build"));

  assert.ok(commands.test);
  assert.equal(commands.test?.cmd, "sh");
  assert.equal(commands.test?.args[0], "-c");
  assert.ok(commands.test?.args[1]?.includes("opam exec -- dune test"));
});

test("ocaml adapter conventions describe dune", () => {
  const adapter = createOcamlDuneAdapter();
  const conventions = adapter.conventions();

  assert.equal(conventions.summary, "OCaml project initialized with dune.");
  assert.equal(conventions.commands.build, "dune build");
  assert.equal(conventions.commands.test, "dune test");
  assert.equal(conventions.layoutHints.lib, "lib/");
  assert.equal(conventions.layoutHints.bin, "bin/");
});
