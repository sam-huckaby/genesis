import fs from "node:fs";
import path from "node:path";
import { resolveWorkspacePath } from "../util/paths.js";

export type WriteFilePatch = {
  type: "write";
  pathRel: string;
  content: string;
};

export type PatchSet = {
  description: string;
  files: WriteFilePatch[];
};

export function applyPatchSet(workspaceDir: string, patch: PatchSet) {
  for (const filePatch of patch.files) {
    if (filePatch.type !== "write") {
      continue;
    }
    const absolute = resolveWorkspacePath(workspaceDir, filePatch.pathRel);
    const dir = path.dirname(absolute);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(absolute, filePatch.content, "utf8");
  }
}
