import type {
  Conventions,
  DetectResult,
  InitResult,
  ProjectAdapter,
  RunSpec
} from "./adapter.types.js";

export function createNextJsAdapter(): ProjectAdapter {
  return {
    id() {
      return "nextjs";
    },
    async detect(): Promise<DetectResult | null> {
      return null;
    },
    async init(projectPathRel: string): Promise<InitResult> {
      const runs: RunSpec[] = [
        {
          cwdRel: ".",
          cmd: "bun",
          args: ["create", "next-app@latest", projectPathRel, "--yes"],
          allow: "scaffold",
          stdin: "n\n"
        },
        {
          cwdRel: projectPathRel,
          cmd: "bun",
          args: ["install"],
          allow: "build"
        }
      ];

      const makefileContent = `.PHONY: build test

build:
	bun run build

test:
	bun run lint
`;

      const agentContent = `# AGENT

This project is managed by the Seed harness. All code changes are proposed and reviewed before apply.

## Dev commands (bun)
- Run dev server: \`bun dev\`
- Build: \`make build\`
- Test: \`make test\`
- Lint: \`bun lint\`

## Workflow
- Use the Seed UI to propose changes and review patches.
- Tasks and subtasks are managed in the Seed UI.
- Keep edits inside this project directory.

## Notes
- This file is safe to update if conventions change.
`;

      const conventions: Conventions = {
        summary: "Next.js app directory with TypeScript and ESLint.",
        commands: {
          dev: "bun dev",
          build: "make build",
          test: "make test",
          lint: "bun lint"
        },
        layoutHints: {
          app: "app/",
          components: "components/"
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
          { title: "Verify local run" },
          { title: "Start dev server" },
          { title: "Open homepage in browser" },
          { title: "Run lint" },
          { title: "Define initial scope" }
        ]
      };
    },
    commands(projectPathRel: string) {
      return {
        dev: {
          cwdRel: projectPathRel,
          cmd: "bun",
          args: ["dev"],
          allow: "dev"
        },
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
        },
        lint: {
          cwdRel: projectPathRel,
          cmd: "bun",
          args: ["lint"],
          allow: "lint"
        }
      };
    },
    conventions() {
      return {
        summary: "Next.js app directory with TypeScript and ESLint.",
        commands: {
          dev: "bun dev",
          build: "make build",
          test: "make test",
          lint: "bun lint"
        },
        layoutHints: {
          app: "app/",
          components: "components/"
        }
      };
    }
  };
}
