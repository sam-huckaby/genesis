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

export type ProjectBuildPromptRequest = {
  prompt: string;
};

export type ProjectBuildPromptResponse = {
  prompt?: string;
  createdAt?: string;
};

export type ProjectBuildRunResponse = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  message?: string;
};

export type ProjectDeployRequest = {
  targetId: string;
};

export type ProjectDeployResponse = ProjectBuildRunResponse;

export type ProjectBuildLoopRequest = {
  maxIterations?: number;
  modelOverride?: string;
};

export type ProjectBuildLoopIteration = {
  iteration: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  assistantSummary?: string | null;
};

export type ProjectBuildLoopResponse = {
  ok: boolean;
  loopId: number;
  lastIteration: ProjectBuildLoopIteration | null;
  message?: string;
};

export type ProjectBuildLoopSummary = {
  id: number;
  status: string;
  maxIterations: number;
  stopReason?: string | null;
  model?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectBuildLoopListResponse = {
  loops: ProjectBuildLoopSummary[];
};

export type ProjectBuildLoopDetail = ProjectBuildLoopSummary & {
  iterations: ProjectBuildLoopIteration[];
};

export type ProjectBuildLoopDetailResponse = {
  loop: ProjectBuildLoopDetail | null;
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

export type ProjectChatMessage = {
  id: number;
  conversationId?: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  kind?: "message" | "tool";
  status?: "running" | "done" | "error";
  toolName?: string | null;
  toolMeta?: string | null;
  selections?: { start: number; end: number }[];
};

export type ProjectChatConversation = {
  id: number;
  projectId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string | null;
  lastViewedAt?: string | null;
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
  createdAt?: string;
  parentId?: number | null;
  closeReason?: string | null;
  stashRef?: string | null;
  files: { path: string; diff: string }[];
};

export type ChangesetTestRequest = {
  force?: boolean;
};

export type ChangesetTestResponse = {
  applied: boolean;
  warning?: string;
};

export type ChangesetCloseRequest = {
  reason?: string;
};

export type ChangesetRebuildRequest = {
  mode?: "branch" | "replace";
  summary?: string;
  diff?: string;
};

export type ChangesetRebuildResponse = {
  ok: boolean;
  stashRef: string;
  changesetId?: number;
  parentId?: number;
};

export type ChangesetChatMessage = {
  role: "user" | "assistant";
  content: string;
};
