# Build Loop Documentation

## Overview
The build loop orchestrates repeated compile/build attempts for a project. It runs the adapter’s build command, captures failures, asks an LLM to apply minimal fixes, and retries. This loop is separate from the normal build-mode chat used for feature development.

## Inputs and Parameters
`BuildLoopParams` (from `build_loop.ts`) defines the loop context:

- `db`: Database handle for recording loop and iteration data.
- `workspaceDir`: Workspace root for running commands and writing logs.
- `apiKey`: API key for LLM requests.
- `project`: `{ id, name, rootPathRel }` for project identification.
- `buildCommand`: Adapter `RunSpec` used for the build.
- `maxIterations`: Maximum number of build attempts in the loop.
- `model`: LLM model name for the loop.
- `toolMaxIterations`: Max tool cycles allowed inside each LLM attempt.
- `projectPrompt`: Optional build prompt provided by discovery/build prompt storage.

## Data Model
Two tables store build loop state and history:

- `project_build_loops`
  - Tracks loop lifecycle (`running`, `success`, `failed`, `blocked`).
  - Stores `max_iterations`, optional `stop_reason`, and the `model` used.

- `project_build_iterations`
  - Stores each attempt with `exit_code`, full `stdout`, `stderr`.
  - Stores `assistant_summary` to preserve what the LLM tried.

These records allow post-hoc inspection and LLM retrieval via tools.

## Control Flow (Step-by-Step)
1. Create a loop row in `project_build_loops` (status `running`).
2. Emit `project.build_loop.started` event.
3. For each iteration:
   - Run `runSpec()` with the adapter build command.
   - If build succeeds:
     - Insert iteration row with `exit_code = 0`.
     - Update loop status to `success`.
     - Emit `project.build_loop.succeeded`.
     - Return `{ ok: true, loopId, lastIteration }`.
   - If build fails:
     - Build a prompt containing:
       - Project build prompt (if any)
       - Last attempt summary (if any)
       - The current failure (`exit code`, `stdout`, `stderr`)
     - Call the build-loop LLM flow with a short fixed prompt.
     - Capture the LLM’s summary in `assistant_summary`.
     - Insert the iteration row and emit `project.build_loop.iteration`.
     - If the LLM requested stop (`build_loop_stop`):
       - Mark loop `blocked`, store `stop_reason`.
       - Emit `project.build_loop.blocked`.
       - Return `{ ok: false, loopId, lastIteration, message }`.
4. If max iterations are reached:
   - Mark loop `failed`.
   - Emit `project.build_loop.failed`.
   - Return `{ ok: false, loopId, lastIteration }`.

## Tooling Inside the Loop
The loop LLM can use a subset of tools plus build-loop helpers:

- `build_loop_stop(reason)`
  - Ends the loop with status `blocked`.
  - Stores `stop_reason` and returns `ok: false` to the caller.

- `get_build_loops(projectName)`
  - Returns recent loop summaries for the project.

- `get_build_loop_detail(projectName, loopId)`
  - Returns the full iteration history for a loop.

These tools are available to the loop LLM through `search_tools` discovery and `describe_tool` schemas.

## Outputs
The loop returns `ProjectBuildLoopResponse`:

- `ok`: whether the build eventually succeeded.
- `loopId`: id of the loop row.
- `lastIteration`: last build attempt’s output and summary.
- `message`: optional; typically the stop reason when blocked.

## Events and Logs
Events emitted:

- `project.build_loop.started`
- `project.build_loop.iteration`
- `project.build_loop.succeeded`
- `project.build_loop.failed`
- `project.build_loop.blocked`

Logs:

- LLM raw output is appended to `state/logs/build-loop.log`.

## Configuration
Settings are stored in the workspace `settings` table:

- `build_loop_model`: default model for the build loop.
- `project_chat_max_iterations`: max tool iterations inside each LLM attempt.

## ASCII Diagrams

Sequence overview:

```
User/API
  |
  v
BuildLoop -> runSpec(build)
  |             |
  |             +--> success -> record iteration -> mark success -> return
  |
  +--> failure -> prompt -> LLM tool loop
                   |
                   +--> fixes -> runSpec(build) -> retry
                   |
                   +--> build_loop_stop -> mark blocked -> return
```

State transitions:

```
running ---> success
   |
   +------> failed
   |
   +------> blocked
```

## Performance Notes
- Each iteration runs a full build and can be expensive; failures with large stdout/stderr increase DB and log writes.
- LLM tool cycles can be chatty; `project_chat_max_iterations` should stay bounded.
- Full stdout/stderr storage improves diagnosis but increases DB size; consider truncation or compression later.
- Concurrency: multiple loops on the same project can contend for resources. If needed, add a guard to prevent overlapping loops per project.
