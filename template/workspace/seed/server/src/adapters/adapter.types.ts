import type { PatchSet } from "../kernel/patch.js";

export type ProjectType = "nextjs" | "go_service" | "ocaml_dune";

export type RunAllowCategory = "scaffold" | "build" | "test" | "lint" | "dev" | "deploy";

export type RunSpec = {
  cwdRel: string;
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  allow: RunAllowCategory;
  stdin?: string;
};

export type DetectResult = {
  type: ProjectType;
  confidence: number;
  reasons: string[];
};

export type SuggestedTask = {
  title: string;
  description?: string;
  subtasks?: SuggestedTask[];
  tags?: string[];
};

export type Conventions = {
  summary: string;
  commands: Record<string, string>;
  layoutHints: Record<string, string>;
};

export type InitResult = {
  runs: RunSpec[];
  postPatch?: PatchSet;
  conventions: Conventions;
  suggestedTasks: SuggestedTask[];
};

export interface ProjectAdapter {
  id(): ProjectType;
  detect(
    projectPathRel: string,
    readFile: (p: string) => Promise<string | null>
  ): Promise<DetectResult | null>;
  init(projectPathRel: string, options: Record<string, unknown>): Promise<InitResult>;
  commands(projectPathRel: string): {
    dev?: RunSpec;
    build?: RunSpec;
    lint?: RunSpec;
    test?: RunSpec;
    deployTargets?: { id: string; label: string; spec: RunSpec }[];
  };
  conventions(): Conventions;
}
