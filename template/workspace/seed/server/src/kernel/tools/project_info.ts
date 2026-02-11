import fs from "node:fs/promises";
import path from "node:path";
import type { ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";

export type ProjectInfoArgs = { root: string };

export type ProjectInfoResult = {
  root: string;
  isGitRepo: boolean;
  packageManager?: "npm" | "pnpm" | "yarn" | "unknown";
  frameworks: string[];
  languages: string[];
  keyFiles: string[];
  workspaceLayout: {
    hasSrc: boolean;
    hasPackagesDir: boolean;
    hasAppsDir: boolean;
  };
};

export const spec: ToolSpec = {
  name: "project_info",
  description: "Summarize the project structure and key metadata for a root directory.",
  argsSchema: {
    type: "object",
    properties: {
      root: { type: "string", description: "Root directory (absolute or relative to workspace)." }
    },
    required: ["root"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      root: { type: "string" },
      isGitRepo: { type: "boolean" },
      packageManager: { type: "string" },
      frameworks: { type: "array", items: { type: "string" } },
      languages: { type: "array", items: { type: "string" } },
      keyFiles: { type: "array", items: { type: "string" } },
      workspaceLayout: {
        type: "object",
        properties: {
          hasSrc: { type: "boolean" },
          hasPackagesDir: { type: "boolean" },
          hasAppsDir: { type: "boolean" }
        },
        required: ["hasSrc", "hasPackagesDir", "hasAppsDir"],
        additionalProperties: false
      }
    },
    required: ["root", "isGitRepo", "frameworks", "languages", "keyFiles", "workspaceLayout"],
    additionalProperties: false
  },
  examples: [
    {
      input: { root: "projects/demo" },
      output: {
        ok: true,
        result: {
          root: "/abs/projects/demo",
          isGitRepo: true,
          packageManager: "npm",
          frameworks: [],
          languages: [],
          keyFiles: [],
          workspaceLayout: { hasSrc: false, hasPackagesDir: false, hasAppsDir: false }
        }
      }
    }
  ],
  tags: ["project", "info"],
  filePath: "seed/server/src/kernel/tools/project_info.ts"
};

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function projectInfo(args: ProjectInfoArgs): Promise<ToolResult<ProjectInfoResult>> {
  try {
    const rootAbs = path.resolve(args.root);

    const keyFiles: string[] = [];
    const pkgPath = path.join(rootAbs, "package.json");
    const hasPkg = await exists(pkgPath);
    if (hasPkg) {
      keyFiles.push("package.json");
    }

    const lockPnpm = await exists(path.join(rootAbs, "pnpm-lock.yaml"));
    const lockYarn = await exists(path.join(rootAbs, "yarn.lock"));
    const lockNpm = await exists(path.join(rootAbs, "package-lock.json"));

    const packageManager = lockPnpm
      ? "pnpm"
      : lockYarn
        ? "yarn"
        : lockNpm
          ? "npm"
          : hasPkg
            ? "unknown"
            : undefined;

    const hasTsconfig = await exists(path.join(rootAbs, "tsconfig.json"));
    if (hasTsconfig) {
      keyFiles.push("tsconfig.json");
    }

    const frameworks: string[] = [];
    const languages: string[] = [];

    if (hasPkg) {
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

      const pushIf = (key: string, name: string) => {
        if (deps[key]) {
          frameworks.push(name);
        }
      };

      pushIf("vite", "vite");
      pushIf("react", "react");
      pushIf("next", "nextjs");
      pushIf("@remix-run/react", "remix");
      pushIf("svelte", "svelte");
      pushIf("vue", "vue");

      if (deps.typescript || hasTsconfig) {
        languages.push("ts");
      } else {
        languages.push("js");
      }
    }

    const workspaceLayout = {
      hasSrc: await exists(path.join(rootAbs, "src")),
      hasPackagesDir: await exists(path.join(rootAbs, "packages")),
      hasAppsDir: await exists(path.join(rootAbs, "apps"))
    };

    return {
      ok: true,
      result: {
        root: rootAbs,
        isGitRepo: await exists(path.join(rootAbs, ".git")),
        packageManager,
        frameworks: Array.from(new Set(frameworks)),
        languages: Array.from(new Set(languages)),
        keyFiles,
        workspaceLayout
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "IO_ERROR",
        message: error instanceof Error ? error.message : "project_info failed",
        details: error
      }
    };
  }
}
