import type {
  Conventions,
  DetectResult,
  InitResult,
  ProjectAdapter
} from "./adapter.types.js";

export function createGoAdapter(): ProjectAdapter {
  return {
    id() {
      return "go_service";
    },
    async detect(): Promise<DetectResult | null> {
      return null;
    },
    async init(): Promise<InitResult> {
      const conventions: Conventions = {
        summary: "Go service with go.mod and cmd/ entrypoint.",
        commands: {
          build: "go build ./...",
          test: "go test ./..."
        },
        layoutHints: {
          cmd: "cmd/",
          internal: "internal/"
        }
      };

      return {
        runs: [],
        conventions,
        suggestedTasks: [{ title: "Define service goal" }]
      };
    },
    commands() {
      return {};
    },
    conventions() {
      return {
        summary: "Go service with go.mod and cmd/ entrypoint.",
        commands: {
          build: "go build ./...",
          test: "go test ./..."
        },
        layoutHints: {
          cmd: "cmd/",
          internal: "internal/"
        }
      };
    }
  };
}
