export type ProjectType = "nextjs" | "go_service" | "ocaml_dune";

export type SuggestedTask = {
  title: string;
  description?: string;
  subtasks?: SuggestedTask[];
  tags?: string[];
};

export type ProjectRecommendation = {
  recommended: ProjectType;
  alternatives: { type: ProjectType; why: string[] }[];
  questionsAsked: string[];
  reasoning: string[];
};

export type DiscoveryRecommendation = {
  recommended: ProjectType;
  alternatives: { type: ProjectType; why: string[] }[];
};

export type DiscoveryStartResponse = {
  discoveryId: number;
};

export type DiscoveryMessageRequest = {
  discoveryId: number;
  role: "user" | "assistant";
  content: string;
};

export type DiscoveryCompleteRequest = {
  discoveryId: number;
  summary?: string;
  recommendedType?: ProjectType;
  alternatives?: { type: ProjectType; why: string[] }[];
  draftBrief?: string;
  suggestedName?: string;
};

export type DiscoveryMessageResponse = {
  status: "needs_more_info" | "ready";
  assistantMessage: string;
  recommendation: DiscoveryRecommendation;
  draftBrief?: string;
  suggestedName?: string;
};

export type CreateProjectRequest = {
  name: string;
  type: ProjectType;
  initMode: "guided" | "discussed";
  toolPreference?: "bun" | "npm";
  brief?: string;
};

export type CreateProjectResponse = {
  project: { name: string; type: ProjectType; rootPathRel: string } | null;
  suggestedTasks: SuggestedTask[];
  nextSteps: { message: string }[];
};

export type AcceptTasksRequest = {
  projectName: string;
  tasks: SuggestedTask[];
};

export type AcceptTasksResponse = {
  ok: boolean;
};

export type ProjectBrief = {
  projectName: string;
  briefText: string;
};

export type SaveProjectBriefRequest = {
  projectName: string;
  briefText: string;
};

export type TaskSelectionRequest = {
  messageId: number;
  start: number;
  end: number;
};

export type TaskSelectionResponse = {
  ok: boolean;
  taskId: number;
};

export type ChangesetProposalRequest = {
  projectName: string;
  summary: string;
  diff: string;
};

export type ChangesetProposalResponse = {
  changesetId: number;
};

export type ChangesetSummary = {
  id: number;
  summary: string;
  status: string;
  createdAt: string;
};

export type ChangesetDetail = {
  id: number;
  summary: string;
  status: string;
  baseRevision: string;
  files: { path: string; diff: string }[];
};
