# Seed CLI

Seed is a “living app seed” that becomes the backbone of the application you are building. You plant a seed in a new workspace, talk to it through a simple UI, and it scaffolds, proposes, and evolves your app through a review-first workflow. Seed apps are living; they can augment their own dev harness over time so the user experience tailors to the developer and the project as it grows.

## Why this exists

Seed is designed to:

- Let non-engineers and engineers build apps from inside the app itself
- Provide an admin/dev harness (like a WordPress admin, but for code too)
- Ensure AI access is embedded from the beginning without shipping a model
- Keep every change explicit and reviewed, even for non-coders

## Core principles

- Proposal-only changes: the model proposes patches, never writes directly
- Explicit approval: users approve every change before it applies
- Sandbox boundaries: the seed only touches its workspace directory
- Persistent memory: decisions, tasks, and changes are recorded

## Two artifacts

- **Seed CLI (this repo)**: installs the `seed` command and copies a workspace template
- **Seed Workspace**: the local “pot” containing the harness, state, and projects (created by the Seed CLI)

## Local Quickstart (bun) -- Real build coming later

Seed uses bun for installs and Next.js scaffolding.

Ripgrep (rg) is required: https://github.com/BurntSushi/ripgrep

## Tool test suite

The seed kernel includes a tool test suite to validate filesystem, git, and tool registry behavior.

Run from `template/workspace/seed/server`:

```bash
  bun install
  node --test --import tsx
```

Install dependencies and run the CLI in dev mode:

```bash
bun install
bun run dev -- init [workspace-name]
```

Or use a one-shot init (when published) (this does NOT work right now):

```bash
bunx @sam-huckaby/seed init [workspace-name]
```

This creates a workspace directory called "workspace-name", runs `bun install` in the workspace, and opens the local UI in your browser.
Start with Discovery to describe your project, review the scaffold recommendation, and then create the project.

## CLI commands

- `seed init <name> [--skip-install]`: create a new workspace and start the server
- `seed open <path>`: WIP - open an existing workspace
- `seed doctor`: WIP - check environment prerequisites

`--skip-install` creates the workspace without installing dependencies or starting the server.

## Workspace layout (high level)

```
my-workspace/
  seed/         # harness server + UI
  state/        # sqlite, logs, secrets (local only)
  projects/     # generated apps
  SEEDLOG.md    # human-readable timeline
  DECISIONS.md  # design decisions
```

## Safety boundaries

Seed only operates inside its workspace directory. By default, project code lives under `projects/<name>/` and all changes go through explicit review before apply. The harness itself is locked by default and requires elevated approval to modify.

## Roadmap cues

Early milestones include adapter-based scaffolding (Next.js, Go, OCaml), task/subtask curation, review-first patching, and optional PR integration. Later, the harness can evolve new panels and workflows as the app grows.
