import fs from "node:fs";
import path from "node:path";
import { isSensitivePath } from "./project_files.js";

type PatchOp =
  | { type: "add"; pathRel: string; lines: string[] }
  | { type: "delete"; pathRel: string }
  | { type: "update"; pathRel: string; hunks: Hunk[] };

type Hunk = {
  lines: string[];
};

function normalizeRelPath(input: string): string {
  const normalized = input.replace(/\\/g, "/").replace(/^\.(\/|$)/, "");
  return normalized.length === 0 ? "." : normalized;
}

function ensureSafePath(pathRel: string) {
  if (path.posix.isAbsolute(pathRel) || pathRel.startsWith("..")) {
    throw new Error("Invalid patch path");
  }
  if (isSensitivePath(pathRel)) {
    throw new Error("Patch touches sensitive or excluded paths");
  }
}

function parsePatch(input: string): PatchOp[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "*** Begin Patch") {
    throw new Error("Missing *** Begin Patch");
  }
  const ops: PatchOp[] = [];
  let index = 1;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "*** End Patch") {
      break;
    }
    if (line.startsWith("*** Add File:")) {
      const pathRel = normalizeRelPath(line.replace("*** Add File:", "").trim());
      const content: string[] = [];
      index += 1;
      while (index < lines.length) {
        const contentLine = lines[index] ?? "";
        if (contentLine.startsWith("*** ") || contentLine.trim() === "*** End Patch") {
          break;
        }
        if (!contentLine.startsWith("+")) {
          throw new Error("Add File lines must start with +");
        }
        content.push(contentLine.slice(1));
        index += 1;
      }
      ops.push({ type: "add", pathRel, lines: content });
      continue;
    }
    if (line.startsWith("*** Delete File:")) {
      const pathRel = normalizeRelPath(line.replace("*** Delete File:", "").trim());
      ops.push({ type: "delete", pathRel });
      index += 1;
      continue;
    }
    if (line.startsWith("*** Update File:")) {
      const pathRel = normalizeRelPath(line.replace("*** Update File:", "").trim());
      const hunks: Hunk[] = [];
      index += 1;
      while (index < lines.length) {
        const hunkLine = lines[index] ?? "";
        if (hunkLine.startsWith("*** ") || hunkLine.trim() === "*** End Patch") {
          break;
        }
        if (!hunkLine.startsWith("@@")) {
          throw new Error("Update File requires @@ hunk header");
        }
        index += 1;
        const hunkLines: string[] = [];
        while (index < lines.length) {
          const bodyLine = lines[index] ?? "";
          if (bodyLine.startsWith("@@") || bodyLine.startsWith("*** ") || bodyLine.trim() === "*** End Patch") {
            break;
          }
          if (bodyLine.length === 0) {
            hunkLines.push("");
          } else {
            const prefix = bodyLine[0];
            if (prefix !== " " && prefix !== "+" && prefix !== "-") {
              throw new Error("Invalid hunk line; must start with space/+/-");
            }
            hunkLines.push(bodyLine);
          }
          index += 1;
        }
        hunks.push({ lines: hunkLines });
      }
      ops.push({ type: "update", pathRel, hunks });
      continue;
    }
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }
    throw new Error(`Unknown patch directive: ${line}`);
  }

  return ops;
}

function applyHunks(original: string, hunks: Hunk[]): string {
  const originalLines = original.replace(/\r\n/g, "\n").split("\n");
  let cursor = 0;

  const findMatchIndex = (start: number, pattern: string[]): number => {
    if (pattern.length === 0) {
      return start;
    }
    for (let i = start; i <= originalLines.length - pattern.length; i += 1) {
      let match = true;
      for (let j = 0; j < pattern.length; j += 1) {
        if (originalLines[i + j] !== pattern[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        return i;
      }
    }
    return -1;
  };

  let lines = [...originalLines];

  for (const hunk of hunks) {
    const oldLines = hunk.lines
      .filter((line) => line.length > 0 && (line[0] === " " || line[0] === "-"))
      .map((line) => line.slice(1));
    const startIndex = findMatchIndex(cursor, oldLines);
    if (startIndex === -1) {
      throw new Error("Context mismatch while applying patch");
    }

    const newSegment: string[] = [];
    let readIndex = startIndex;
    for (const line of hunk.lines) {
      if (line.length === 0) {
        newSegment.push("");
        continue;
      }
      const prefix = line[0];
      const content = line.slice(1);
      if (prefix === " ") {
        if (lines[readIndex] !== content) {
          throw new Error("Context mismatch while applying patch");
        }
        newSegment.push(content);
        readIndex += 1;
      } else if (prefix === "-") {
        if (lines[readIndex] !== content) {
          throw new Error("Removal mismatch while applying patch");
        }
        readIndex += 1;
      } else if (prefix === "+") {
        newSegment.push(content);
      }
    }

    const deleteCount = readIndex - startIndex;
    lines = [...lines.slice(0, startIndex), ...newSegment, ...lines.slice(startIndex + deleteCount)];
    cursor = startIndex + newSegment.length;
  }

  return lines.join("\n");
}

export function applyPatchText(baseDirAbs: string, patchText: string, log?: (msg: string) => void) {
  const ops = parsePatch(patchText);
  for (const op of ops) {
    ensureSafePath(op.pathRel);
    const absolute = path.resolve(baseDirAbs, op.pathRel);
    const root = path.resolve(baseDirAbs) + path.sep;
    log?.(`apply_patch op=${op.type} pathRel=${op.pathRel} absolute=${absolute}`);
    if (!absolute.startsWith(root)) {
      throw new Error("Invalid patch path");
    }
    if (op.type === "add") {
      if (fs.existsSync(absolute)) {
        throw new Error("File already exists");
      }
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, op.lines.join("\n"), "utf8");
      const size = fs.existsSync(absolute) ? fs.statSync(absolute).size : 0;
      log?.(`apply_patch add exists=${fs.existsSync(absolute)} size=${size}`);
      continue;
    }
    if (op.type === "delete") {
      if (!fs.existsSync(absolute)) {
        throw new Error("File does not exist");
      }
      fs.unlinkSync(absolute);
      continue;
    }
    if (!fs.existsSync(absolute)) {
      throw new Error("File does not exist");
    }
    const original = fs.readFileSync(absolute, "utf8");
    const updated = applyHunks(original, op.hunks);
    fs.writeFileSync(absolute, updated, "utf8");
    const size = fs.existsSync(absolute) ? fs.statSync(absolute).size : 0;
    log?.(`apply_patch update size=${size}`);
  }
}
