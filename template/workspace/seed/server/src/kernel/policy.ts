// Write policy for kernel tools that mutate the workspace.
export type WriteScope = {
  allowedRoots: string[];
  allowSeedEdits: boolean;
};

// Default write scope is conservative: user projects + decision logs only.
export const defaultWriteScope: WriteScope = {
  allowedRoots: ["projects", "SEEDLOG.md", "DECISIONS.md"],
  allowSeedEdits: false
};
