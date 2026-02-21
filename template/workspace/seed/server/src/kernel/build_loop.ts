import path from "node:path";
import fs from "node:fs/promises";
import type Database from "better-sqlite3";
import type { RunSpec } from "../adapters/adapter.types.js";
import type { ProjectBuildLoopResponse } from "@shared/types";
import type { ToolResult } from "./tools/tool_result.js";
import { runSpec } from "./runner.js";
import { runProjectChatLlm } from "./project_chat.js";
import { recordEvent } from "../storage/events.js";

export type BuildLoopProject = {
  id: number;
  name: string;
  rootPathRel: string;
};

export type BuildLoopParams = {
  db: Database.Database;
  workspaceDir: string;
  apiKey: string;
  project: BuildLoopProject;
  buildCommand: RunSpec;
  maxIterations: number;
  model: string;
  toolMaxIterations: number;
  projectPrompt: string;
};

function normalizeToolName(name: string): string {
  return name.replace(/^functions\./, "");
}

function buildLoopPrompt(projectRootRel: string): string {
  return (
    "You are an experienced DevOps engineer who specializes in the languages and frameworks used in this project. " +
    "You are running a build-compile loop for a project. " +
    `Project root: ${projectRootRel}. ` +
    "Your job is to fix build failures using tools. " +
    "Do not build features. Keep changes minimal and focused on making the build succeed. " +
    "If you need the user to take an action or cannot proceed, call build_loop_stop with a clear reason. " +
    "After fixes, reply with a short summary of what you changed or attempted."
  );
}

function createTraceLogger(
  logPath: string,
  baseFields: Record<string, unknown>
): (event: string, details?: Record<string, unknown>, iteration?: number, durationMs?: number) => Promise<void> {
  let dirReady = false;
  return async (event, details, iteration, durationMs) => {
    try {
      if (!dirReady) {
        await fs.mkdir(path.dirname(logPath), { recursive: true });
        dirReady = true;
      }
      const payload: Record<string, unknown> = {
        ts: new Date().toISOString(),
        ...baseFields,
        event
      };
      if (typeof iteration === "number") {
        payload.iteration = iteration;
      }
      if (typeof durationMs === "number") {
        payload.durationMs = durationMs;
      }
      if (details && Object.keys(details).length > 0) {
        payload.details = details;
      }
      await fs.appendFile(logPath, `${JSON.stringify(payload)}\n`);
    } catch {
      // Swallow logging errors to avoid breaking the build loop.
    }
  };
}

export async function runBuildLoop(params: BuildLoopParams): Promise<ProjectBuildLoopResponse> {
  // Create the timestamp for the beginning of the loop
  const loopNow = new Date().toISOString();
  // Add this build loop entry to the database
  const loopInfo = params.db
    .prepare(
      "INSERT INTO project_build_loops (project_id, max_iterations, status, stop_reason, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      params.project.id,
      params.maxIterations,
      "running",
      null,
      params.model,
      loopNow,
      loopNow
    );
  // Get the id of the row I just added
  const loopId = Number(loopInfo.lastInsertRowid);
  const traceLogPath = path.join(params.workspaceDir, "state", "logs", "build-loop-trace.log");
  const trace = createTraceLogger(traceLogPath, {
    loopId,
    projectId: params.project.id,
    projectName: params.project.name
  });
  await trace("loop.start", {
    maxIterations: params.maxIterations,
    model: params.model,
    toolMaxIterations: params.toolMaxIterations
  });
  // Emit an event for observability
  recordEvent(
    params.db,
    "project.build_loop.started",
    { name: params.project.name, loopId, maxIterations: params.maxIterations, model: params.model },
    params.project.id
  );

  // Create the first iteration entry for this loop in the database
  const insertIteration = params.db.prepare(
    "INSERT INTO project_build_iterations (loop_id, project_id, iteration, exit_code, stdout, stderr, assistant_summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  // Prepare a query to update the loop status for anytime its status should change
  const updateLoopStatus = params.db.prepare(
    "UPDATE project_build_loops SET status = ?, stop_reason = ?, updated_at = ? WHERE id = ?"
  );

  // Running tallies for the things we care about
  let lastSummary = ""; // The last thing the build assistant tried
  let stopRequested = false; // Did the build assistant give up
  let stopReason = ""; // Why did the build assistant give up
  let lastIterationResult: ProjectBuildLoopResponse["lastIteration"] = null; // Did the build assistant get a working build

  // Loop for up to the max iteration trying to fix the build
  for (let iteration = 1; iteration <= params.maxIterations; iteration += 1) {
    await trace("iteration.start", undefined, iteration);
    // Start by running the build spec to see if it succeeds
    const runSpecStarted = Date.now();
    await trace("build.run_spec.start", undefined, iteration);
    const result = await runSpec(params.workspaceDir, params.buildCommand);
    await trace(
      "build.run_spec.end",
      {
        exitCode: result.exitCode,
        stdoutLength: result.stdout.length,
        stderrLength: result.stderr.length
      },
      iteration,
      Date.now() - runSpecStarted
    );
    // Grab the current time, so we can track that, because who knows, maybe that's important
    const iterationNow = new Date().toISOString();
    // Store the assistant's summary of this iteration
    let assistantSummary: string | null = null;

    // WHAT!? THE BUILD SUCCEEDED!? ITS A MIRACLE!! TELL MY MOM I LOVE HER!!
    if (result.exitCode === 0) {
      // Insert the iteration results into the DB
      insertIteration.run(
        loopId,
        params.project.id,
        iteration,
        result.exitCode,
        result.stdout,
        result.stderr,
        null,
        iterationNow
      );
      // Emit an iteration event
      recordEvent(
        params.db,
        "project.build_loop.iteration",
        { loopId, iteration, exitCode: result.exitCode },
        params.project.id
      );
      // Update the loop status in the database to "success"
      updateLoopStatus.run("success", null, new Date().toISOString(), loopId);
      await trace("loop.success", undefined, iteration);
      // Emit a build succeeded event
      recordEvent(
        params.db,
        "project.build_loop.succeeded",
        { loopId, iteration },
        params.project.id
      );
      // Compile a quick object to send back to the calling agent
      lastIterationResult = {
        iteration,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        assistantSummary: null
      };
      // Give the calling agent the results so it can formulate next steps
      return {
        ok: true,
        loopId,
        lastIteration: lastIterationResult
      };
    }

    // So, the build did not succeed, what's next?

    // First, construct a new peptalk to send to the agent
    // TODO: We may want to fine-tune this, it seems like a bit of this is waste
    const promptParts: string[] = [];
    if (params.projectPrompt) {
      promptParts.push(`Project build prompt:\n${params.projectPrompt}`);
    }
    if (lastSummary) {
      promptParts.push(`Previous attempt summary:\n${lastSummary}`);
    }
    promptParts.push(
      `Build failure (iteration ${iteration}):\nExit code: ${result.exitCode}\n\nSTDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}`
    );
    const userContent = `${promptParts.join("\n\n")}\n\nFix the build.`;

    // Begin trying to fix things
    try {
      const projectRootAbs = path.join(params.workspaceDir, params.project.rootPathRel);
      const logPath = path.join(params.workspaceDir, "state", "logs", "build-loop.log");
      const llmStarted = Date.now();
      await trace("llm.start", undefined, iteration);
      const summary = await runProjectChatLlm({
        apiKey: params.apiKey,
        workspaceDir: params.workspaceDir,
        projectRootAbs,
        projectRootRel: params.project.rootPathRel,
        history: [{ role: "user", content: userContent }],
        mode: "build",
        maxIterations: params.toolMaxIterations,
        logPath,
        modelOverride: params.model,
        systemPromptOverride: buildLoopPrompt(params.project.rootPathRel),
        toolExecutor: async (call): Promise<ToolResult<unknown> | null> => {
          const toolName = normalizeToolName(call.function.name);
          const rawArgs = call.function.arguments;
          let args: Record<string, unknown> = {};
          let argsKeys: string[] = [];
          try {
            args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
            argsKeys = Object.keys(args);
          } catch {
            await trace(
              "tool.call",
              {
                toolName,
                argsKeys: []
              },
              iteration
            );
            await trace("tool.error", { toolName, code: "INVALID_ARGS" }, iteration);
            return {
              ok: false,
              error: { code: "INVALID_ARGS", message: "Invalid tool arguments" }
            };
          }
          await trace(
            "tool.call",
            {
              toolName,
              argsKeys
            },
            iteration
          );

          if (toolName === "build_loop_stop") {
            const reason = typeof args.reason === "string" ? args.reason.trim() : "";
            if (!reason) {
              await trace("tool.error", { toolName, code: "INVALID_ARGS" }, iteration);
              return {
                ok: false,
                error: { code: "INVALID_ARGS", message: "Missing reason" }
              };
            }
            stopRequested = true;
            stopReason = reason;
            await trace("tool.build_loop_stop", { reason }, iteration);
            return { ok: true, stopped: true, reason } as ToolResult<unknown>;
          }

          if (toolName === "get_build_loops") {
            const requestedProject =
              typeof args.projectName === "string" ? args.projectName.trim() : "";
            if (!requestedProject || requestedProject !== params.project.name) {
              await trace("tool.error", { toolName, code: "INVALID_ARGS" }, iteration);
              return {
                ok: false,
                error: { code: "INVALID_ARGS", message: "Unknown project" }
              };
            }
            const rawLimit = typeof args.limit === "number" ? args.limit : 20;
            const limit = Math.max(1, Math.min(50, Math.floor(rawLimit)));
            const loops = params.db
              .prepare(
                "SELECT id, status, max_iterations, stop_reason, model, created_at, updated_at FROM project_build_loops WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
              )
              .all(params.project.id, limit) as {
                id: number;
                status: string;
                max_iterations: number;
                stop_reason: string | null;
                model: string | null;
                created_at: string;
                updated_at: string;
              }[];
            return {
              ok: true,
              loops: loops.map((row) => ({
                id: row.id,
                status: row.status,
                maxIterations: row.max_iterations,
                stopReason: row.stop_reason,
                model: row.model,
                createdAt: row.created_at,
                updatedAt: row.updated_at
              }))
            } as ToolResult<unknown>;
          }

          if (toolName === "get_build_loop_detail") {
            const requestedProject =
              typeof args.projectName === "string" ? args.projectName.trim() : "";
            const loopIdArg = typeof args.loopId === "number" ? args.loopId : NaN;
            if (!requestedProject || requestedProject !== params.project.name || !Number.isFinite(loopIdArg)) {
              await trace("tool.error", { toolName, code: "INVALID_ARGS" }, iteration);
              return {
                ok: false,
                error: { code: "INVALID_ARGS", message: "Invalid project or loopId" }
              };
            }
            const loopRow = params.db
              .prepare(
                "SELECT id, status, max_iterations, stop_reason, model, created_at, updated_at FROM project_build_loops WHERE id = ? AND project_id = ?"
              )
              .get(loopIdArg, params.project.id) as {
                id: number;
                status: string;
                max_iterations: number;
                stop_reason: string | null;
                model: string | null;
                created_at: string;
                updated_at: string;
              } | undefined;
            if (!loopRow) {
              return { ok: true, loop: null } as ToolResult<unknown>;
            }
            const iterations = params.db
              .prepare(
                "SELECT id, iteration, exit_code, stdout, stderr, assistant_summary, created_at FROM project_build_iterations WHERE loop_id = ? ORDER BY iteration"
              )
              .all(loopIdArg) as {
                id: number;
                iteration: number;
                exit_code: number;
                stdout: string;
                stderr: string;
                assistant_summary: string | null;
                created_at: string;
              }[];
            return {
              ok: true,
              loop: {
                id: loopRow.id,
                status: loopRow.status,
                maxIterations: loopRow.max_iterations,
                stopReason: loopRow.stop_reason,
                model: loopRow.model,
                createdAt: loopRow.created_at,
                updatedAt: loopRow.updated_at,
                iterations: iterations.map((row) => ({
                  id: row.id,
                  iteration: row.iteration,
                  exitCode: row.exit_code,
                  stdout: row.stdout,
                  stderr: row.stderr,
                  assistantSummary: row.assistant_summary,
                  createdAt: row.created_at
                }))
              }
            } as ToolResult<unknown>;
          }
          await trace("tool.unknown", { toolName }, iteration);
          return null;
        }
      });
      assistantSummary = summary;
      lastSummary = summary;
      await trace(
        "llm.end",
        { summaryLength: summary.length },
        iteration,
        Date.now() - llmStarted
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Build loop LLM failed";
      assistantSummary = `LLM error: ${reason}`;
      stopRequested = true;
      stopReason = reason;
      await trace("llm.error", { reason }, iteration);
    }

    insertIteration.run(
      loopId,
      params.project.id,
      iteration,
      result.exitCode,
      result.stdout,
      result.stderr,
      assistantSummary,
      iterationNow
    );
    recordEvent(
      params.db,
      "project.build_loop.iteration",
      { loopId, iteration, exitCode: result.exitCode },
      params.project.id
    );

    lastIterationResult = {
      iteration,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      assistantSummary
    };

    await trace("iteration.recorded", { exitCode: result.exitCode }, iteration);

    if (stopRequested) {
      updateLoopStatus.run("blocked", stopReason, new Date().toISOString(), loopId);
      await trace("loop.blocked", { reason: stopReason }, iteration);
      recordEvent(
        params.db,
        "project.build_loop.blocked",
        { loopId, iteration, reason: stopReason },
        params.project.id
      );
      return {
        ok: false,
        loopId,
        lastIteration: lastIterationResult,
        message: stopReason
      };
    }
  }

  updateLoopStatus.run("failed", null, new Date().toISOString(), loopId);
  await trace("loop.failed");
  recordEvent(params.db, "project.build_loop.failed", { loopId }, params.project.id);
  return {
    ok: false,
    loopId,
    lastIteration: lastIterationResult
  };
}
