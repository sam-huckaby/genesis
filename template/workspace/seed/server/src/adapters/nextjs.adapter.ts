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
        }
      ];

      const agentContent = `# AGENT

This project is managed by the Seed harness. All code changes are proposed and reviewed before apply.

## Dev commands (bun)
- Run dev server: \`bun dev\`
- Lint: \`bun lint\`
- Build: \`bun run build\`

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
          build: "bun run build",
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
          description: "Add AGENT.md for Seed workflow guidance",
          files: [
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
          cmd: "bun",
          args: ["run", "build"],
          allow: "build"
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
          build: "bun run build",
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
