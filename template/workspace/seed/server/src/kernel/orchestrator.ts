export type OrchestratorState = {
  activeProject: string | null;
};

export function createOrchestrator(): OrchestratorState {
  return {
    activeProject: null
  };
}
