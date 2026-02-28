// Orchestrator state is currently minimal: track the active project name.
export type OrchestratorState = {
  activeProject: string | null;
};

export function createOrchestrator(): OrchestratorState {
  // Factory for a clean state object; kept here for future expansion.
  return {
    activeProject: null
  };
}
