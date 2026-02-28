import type {
  Conventions,
  DetectResult,
  InitResult,
  ProjectAdapter,
  RunSpec
} from "./adapter.types.js";

export function createGoAdapter(): ProjectAdapter {
  return {
    id() {
      return "go_service";
    },
    async detect(): Promise<DetectResult | null> {
      return null;
    },
    async init(projectPathRel: string): Promise<InitResult> {
      const makefileContent = `.PHONY: build test

build:
	go build ./...

test:
	go test ./...
`;

      const conventions: Conventions = {
        summary: "Go service with go.mod and cmd/ entrypoint.",
        commands: {
          build: "make build",
          test: "make test"
        },
        layoutHints: {
          cmd: "cmd/",
          internal: "internal/"
        }
      };

      const runs: RunSpec[] = [];

      return {
        runs,
        postPatch: {
          description: "Add Makefile for unified build and test commands",
          files: [
            {
              type: "write",
              pathRel: `${projectPathRel}/Makefile`,
              content: makefileContent
            }
          ]
        },
        conventions,
        suggestedTasks: [{ title: "Define service goal" }]
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
        summary: "Go service with go.mod and cmd/ entrypoint.",
        commands: {
          build: "make build",
          test: "make test"
        },
        layoutHints: {
          cmd: "cmd/",
          internal: "internal/"
        }
      };
    }
  };
}
