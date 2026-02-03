export type WriteScope = {
  allowedRoots: string[];
  allowSeedEdits: boolean;
};

export const defaultWriteScope: WriteScope = {
  allowedRoots: ["projects", "SEEDLOG.md", "DECISIONS.md"],
  allowSeedEdits: false
};
