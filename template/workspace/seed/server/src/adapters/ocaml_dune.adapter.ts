import type {
  Conventions,
  DetectResult,
  InitResult,
  ProjectAdapter
} from "./adapter.types.js";

export function createOcamlDuneAdapter(): ProjectAdapter {
  return {
    id() {
      return "ocaml_dune";
    },
    async detect(): Promise<DetectResult | null> {
      return null;
    },
    async init(): Promise<InitResult> {
      const conventions: Conventions = {
        summary: "OCaml project initialized with dune.",
        commands: {
          build: "dune build",
          test: "dune test"
        },
        layoutHints: {
          lib: "lib/",
          bin: "bin/"
        }
      };

      return {
        runs: [],
        conventions,
        suggestedTasks: [{ title: "Define project scope" }]
      };
    },
    commands() {
      return {};
    },
    conventions() {
      return {
        summary: "OCaml project initialized with dune.",
        commands: {
          build: "dune build",
          test: "dune test"
        },
        layoutHints: {
          lib: "lib/",
          bin: "bin/"
        }
      };
    }
  };
}
