import type {
  Conventions,
  DetectResult,
  InitResult,
  ProjectAdapter,
  RunSpec
} from "./adapter.types.js";
import path from "node:path";

export function createOcamlDuneAdapter(): ProjectAdapter {
  const missingMessage =
    "OCaml adapter requires opam and dune. Install opam, run \"opam install dune\", or choose another scaffold.";
  const wrapShell = (script: string) => `'${script}'`;
  const opamProbe = [
    "OPAM=\"\"",
    "if [ -n \"$OPAMROOT\" ] && [ -x \"$OPAMROOT/opam\" ]; then OPAM=\"$OPAMROOT/opam\"; fi",
    "if [ -z \"$OPAM\" ] && [ -x \"$HOME/.opam/opam\" ]; then OPAM=\"$HOME/.opam/opam\"; fi",
    "if [ -z \"$OPAM\" ] && [ -x \"/opt/homebrew/bin/opam\" ]; then OPAM=\"/opt/homebrew/bin/opam\"; fi",
    "if [ -z \"$OPAM\" ] && [ -x \"/usr/local/bin/opam\" ]; then OPAM=\"/usr/local/bin/opam\"; fi",
    "if [ -z \"$OPAM\" ] && [ -x \"/usr/bin/opam\" ]; then OPAM=\"/usr/bin/opam\"; fi",
    "if [ -z \"$OPAM\" ]; then OPAM=\"$(command -v opam 2>/dev/null)\"; fi"
  ].join("; ");
  const preflight = [
    "if command -v dune >/dev/null 2>&1; then exit 0; fi",
    opamProbe,
    "if [ -n \"$OPAM\" ]; then \"$OPAM\" exec -- dune --version >/dev/null 2>&1 && exit 0; fi",
    `echo \"${missingMessage}\" 1>&2`,
    "exit 1"
  ].join("; ");
  const duneRun = (args: string) =>
    `if command -v dune >/dev/null 2>&1; then dune ${args}; else ${opamProbe}; if [ -n "$OPAM" ]; then "$OPAM" exec -- dune ${args}; else echo "${missingMessage}" 1>&2; exit 1; fi; fi`;

  return {
    id() {
      return "ocaml_dune";
    },
    async detect(): Promise<DetectResult | null> {
      return null;
    },
    async init(projectPathRel: string): Promise<InitResult> {
      const projectName = path.basename(projectPathRel);
      const parentDir = path.dirname(projectPathRel);
      const runs: RunSpec[] = [
        {
          cwdRel: ".",
          cmd: "sh",
          args: ["-c", wrapShell(preflight)],
          allow: "scaffold"
        },
        {
          cwdRel: parentDir,
          cmd: "sh",
          args: ["-c", wrapShell(duneRun(`init proj ${projectName}`))],
          allow: "scaffold"
        },
        {
          cwdRel: projectPathRel,
          cmd: "sh",
          args: ["-c", wrapShell(duneRun("build"))],
          allow: "build"
        }
      ];

      const makefileContent = `.PHONY: build test

build:
	@if command -v dune >/dev/null 2>&1; then dune build; else OPAM=""; if [ -n "$$OPAMROOT" ] && [ -x "$$OPAMROOT/opam" ]; then OPAM="$$OPAMROOT/opam"; fi; if [ -z "$$OPAM" ] && [ -x "$$HOME/.opam/opam" ]; then OPAM="$$HOME/.opam/opam"; fi; if [ -z "$$OPAM" ] && [ -x "/opt/homebrew/bin/opam" ]; then OPAM="/opt/homebrew/bin/opam"; fi; if [ -z "$$OPAM" ] && [ -x "/usr/local/bin/opam" ]; then OPAM="/usr/local/bin/opam"; fi; if [ -z "$$OPAM" ] && [ -x "/usr/bin/opam" ]; then OPAM="/usr/bin/opam"; fi; if [ -z "$$OPAM" ]; then OPAM="$$(command -v opam 2>/dev/null)"; fi; if [ -n "$$OPAM" ]; then "$$OPAM" exec -- dune build; else echo "${missingMessage}" 1>&2; exit 1; fi; fi

test:
	@if command -v dune >/dev/null 2>&1; then dune test; else OPAM=""; if [ -n "$$OPAMROOT" ] && [ -x "$$OPAMROOT/opam" ]; then OPAM="$$OPAMROOT/opam"; fi; if [ -z "$$OPAM" ] && [ -x "$$HOME/.opam/opam" ]; then OPAM="$$HOME/.opam/opam"; fi; if [ -z "$$OPAM" ] && [ -x "/opt/homebrew/bin/opam" ]; then OPAM="/opt/homebrew/bin/opam"; fi; if [ -z "$$OPAM" ] && [ -x "/usr/local/bin/opam" ]; then OPAM="/usr/local/bin/opam"; fi; if [ -z "$$OPAM" ] && [ -x "/usr/bin/opam" ]; then OPAM="/usr/bin/opam"; fi; if [ -z "$$OPAM" ]; then OPAM="$$(command -v opam 2>/dev/null)"; fi; if [ -n "$$OPAM" ]; then "$$OPAM" exec -- dune test; else echo "${missingMessage}" 1>&2; exit 1; fi; fi
`;

      const agentContent = `# AGENT

This project is managed by the Seed harness. All code changes are proposed and reviewed before apply.

## Dev commands (dune)
- Build: \`make build\`
- Test: \`make test\`

## Workflow
- Use the Seed UI to propose changes and review patches.
- Tasks and subtasks are managed in the Seed UI.
- Keep edits inside this project directory.

## Notes
- This file is safe to update if conventions change.
`;

      const conventions: Conventions = {
        summary: "OCaml project initialized with dune.",
        commands: {
          build: "make build",
          test: "make test"
        },
        layoutHints: {
          lib: "lib/",
          bin: "bin/"
        }
      };

      return {
        runs,
        postPatch: {
          description: "Add Makefile and AGENT.md for Seed workflow guidance",
          files: [
            {
              type: "write",
              pathRel: `${projectPathRel}/Makefile`,
              content: makefileContent
            },
            {
              type: "write",
              pathRel: `${projectPathRel}/AGENT.md`,
              content: agentContent
            }
          ]
        },
        conventions,
        suggestedTasks: [
          { title: "Verify dune build" },
          { title: "Run tests" },
          { title: "Define project scope" }
        ]
      };
    },
    commands(projectPathRel: string) {
      return {
        build: {
          cwdRel: projectPathRel,
          cmd: "make",
          args: ["build"],
          allow: "build"
        },
        test: {
          cwdRel: projectPathRel,
          cmd: "make",
          args: ["test"],
          allow: "test"
        }
      };
    },
    conventions() {
      return {
        summary: "OCaml project initialized with dune.",
        commands: {
          build: "make build",
          test: "make test"
        },
        layoutHints: {
          lib: "lib/",
          bin: "bin/"
        }
      };
    }
  };
}
