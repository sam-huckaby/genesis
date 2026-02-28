import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { resolvePathWithinRoot } from "./safe_path.js";
import type { ToolErrorCode, ToolResult } from "./tool_result.js";
import type { ToolSpec } from "./tool_spec.js";

// Tool to perform small, anchored edits with strong precondition checks.
export type Anchor =
  | { type: "text"; value: string }
  | { type: "eof" };

export type EditFileArgs = {
  allowedRootAbs: string;
  path: string;
  expectedSha256: string;
  mode: "anchor_replace" | "insert_after" | "append";
  before?: Anchor;
  after?: Anchor;
  replacement?: string;
  anchor?: Anchor;
  text?: string;
  expectedOccurrences?: number;
  searchFrom?: number;
};

export type EditFileResult = {
  shaBefore: string;
  shaAfter: string;
  bytesBefore: number;
  bytesAfter: number;
  match: {
    startOffset: number;
    endOffset: number;
    startLine: number;
    endLine: number;
    occurrences: number;
  };
};

export const spec: ToolSpec = {
  name: "edit_file",
  description:
    "Edit a file using explicit anchor modes. Prefer for small, targeted edits.",
  argsSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to project root." },
      expectedSha256: { type: "string", description: "SHA256 of file content previously read." },
      mode: {
        type: "string",
        enum: ["anchor_replace", "insert_after", "append"],
        description: "Edit mode."
      },
      before: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["text", "eof"] },
          value: { type: "string" }
        },
        additionalProperties: false
      },
      after: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["text", "eof"] },
          value: { type: "string" }
        },
        additionalProperties: false
      },
      anchor: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["text", "eof"] },
          value: { type: "string" }
        },
        additionalProperties: false
      },
      replacement: { type: "string", description: "Replacement content." },
      text: { type: "string", description: "Insert/append text." },
      expectedOccurrences: {
        type: "number",
        description: "Expected number of matches (default 1)."
      },
      searchFrom: {
        type: "number",
        description: "Optional start offset in characters (default 0)."
      }
    },
    required: ["path", "expectedSha256", "mode"],
    additionalProperties: false
  },
  returnsSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      shaBefore: { type: "string" },
      shaAfter: { type: "string" },
      bytesBefore: { type: "number" },
      bytesAfter: { type: "number" },
      match: {
        type: "object",
        properties: {
          startOffset: { type: "number" },
          endOffset: { type: "number" },
          startLine: { type: "number" },
          endLine: { type: "number" },
          occurrences: { type: "number" }
        },
        required: ["startOffset", "endOffset", "startLine", "endLine", "occurrences"],
        additionalProperties: false
      },
      error: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          hint: { type: "string" }
        },
        required: ["code", "message"],
        additionalProperties: false
      }
    },
    required: ["ok"],
    additionalProperties: false
  },
  examples: [
    {
      input: {
        path: "README.md",
        expectedSha256: "<sha>",
        mode: "anchor_replace",
        before: { type: "text", value: "## Notes\n" },
        after: { type: "text", value: "\n## Next" },
        replacement: "Updated notes\n",
        expectedOccurrences: 1
      },
      output: {
        ok: true,
        shaBefore: "<sha>",
        shaAfter: "<sha>",
        bytesBefore: 100,
        bytesAfter: 110,
        match: { startOffset: 10, endOffset: 50, startLine: 2, endLine: 3, occurrences: 1 }
      }
    }
  ],
  tags: ["fs", "edit"],
  filePath: "seed/server/src/kernel/tools/edit_file.ts"
};

function sha256(text: string) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function byteSize(text: string) {
  return Buffer.byteLength(text, "utf8");
}

function indexToLine(text: string, index: number): number {
  // Convert character index to 1-based line number for diagnostics.
  if (index <= 0) {
    return 1;
  }
  let line = 1;
  for (let i = 0; i < text.length && i < index; i += 1) {
    if (text[i] === "\n") {
      line += 1;
    }
  }
  return line;
}

type MatchRegion = {
  start: number;
  end: number;
  beforeEnd: number;
  afterStart: number;
  beforeValue?: string;
  afterValue?: string;
};

function isTextAnchor(anchor: Anchor | undefined): anchor is { type: "text"; value: string } {
  return !!anchor && anchor.type === "text";
}

function isEofAnchor(anchor: Anchor | undefined): anchor is { type: "eof" } {
  return !!anchor && anchor.type === "eof";
}

function validateTextAnchor(anchor: Anchor | undefined):
  | { ok: true }
  | { ok: false; code: ToolErrorCode; message: string } {
  // Validate required shape and value for anchors.
  if (!anchor) {
    return { ok: false, code: "ANCHOR_REQUIRED", message: "Anchor is required." };
  }
  if (anchor.type !== "text" && anchor.type !== "eof") {
    return { ok: false, code: "ANCHOR_TYPE_INVALID", message: "Invalid anchor type." };
  }
  if (anchor.type === "text" && (!anchor.value || anchor.value.length === 0)) {
    return { ok: false, code: "ANCHOR_VALUE_MISSING", message: "Anchor value is required." };
  }
  return { ok: true };
}

function checkOverlaps(matches: MatchRegion[], source: string):
  | { ok: true }
  | { ok: false; code: ToolErrorCode; message: string; details?: unknown } {
  // Reject overlapping anchor ranges to avoid ambiguous edits.
  if (matches.length <= 1) {
    return { ok: true as const };
  }
  const sorted = [...matches].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.start < prev.end) {
      return {
        ok: false as const,
        code: "OVERLAPPING_ANCHORS",
        message: "Anchor matches overlap. Provide more specific anchors.",
        details: {
          conflicts: [prev, cur].map((match) => ({
            startOffset: match.start,
            endOffset: match.end,
            startLine: indexToLine(source, match.start),
            endLine: indexToLine(source, match.end),
            before: match.beforeValue,
            after: match.afterValue
          }))
        }
      };
    }
  }
  return { ok: true as const };
}

export async function editFile(input: EditFileArgs): Promise<ToolResult<EditFileResult>> {
  // Resolve and validate the target path before reading.
  const resolved = await resolvePathWithinRoot({
    allowedRootAbs: input.allowedRootAbs,
    relativePath: input.path
  });
  if (!resolved.ok) {
    return {
      ok: false,
      error: { code: resolved.code, message: "Path rejected", details: resolved.details }
    };
  }

  const rel = input.path.replaceAll("\\", "/");
  const baseName = path.posix.basename(rel);
  // Deny editing sensitive paths regardless of tool args.
  if (rel.startsWith(".git/") || rel === ".git") {
    return {
      ok: false,
      error: {
        code: "DENYLIST_PATH",
        message: "Refusing to edit .git directory",
        details: { path: rel }
      }
    };
  }
  if (baseName === ".env" || baseName.startsWith(".env.")) {
    return {
      ok: false,
      error: {
        code: "DENYLIST_PATH",
        message: "Refusing to edit env files",
        details: { path: rel }
      }
    };
  }

  let before: string;
  try {
    before = await fs.readFile(resolved.absPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "READ_FAILED",
        message: "Failed to read file",
        details: { error: String(error) }
      }
    };
  }

  const normalizedBefore = before.replace(/\r\n/g, "\n");
  const shaBefore = sha256(normalizedBefore);
  if (shaBefore !== input.expectedSha256) {
    // Prevent editing stale content; caller must re-read.
    return {
      ok: false,
      error: {
        code: "PRECONDITION_FAILED",
        message: "File contents changed since the model read it. Re-read and try again.",
        details: { expectedSha256: input.expectedSha256, actualSha256: shaBefore }
      }
    };
  }

  const searchFrom = typeof input.searchFrom === "number" && input.searchFrom > 0
    ? Math.floor(input.searchFrom)
    : 0;
  const expectedOccurrences =
    typeof input.expectedOccurrences === "number" && input.expectedOccurrences > 0
      ? Math.floor(input.expectedOccurrences)
      : 1;
  const matches: MatchRegion[] = [];
  let replaceStart = 0;
  let replaceEnd = 0;
  let replacementText = "";

  if (input.mode === "anchor_replace") {
    // Replace text between before/after anchors with replacement.
    const beforeAnchor = input.before;
    const afterAnchor = input.after;
    const replacement = input.replacement ?? "";

    if (!beforeAnchor || !afterAnchor) {
      return {
        ok: false,
        error: { code: "ANCHOR_REQUIRED", message: "before and after anchors are required." }
      };
    }
    const afterAnchorSafe = afterAnchor as Anchor;

    const beforeValidation = validateTextAnchor(beforeAnchor);
    if (!beforeValidation.ok) {
      return { ok: false, error: { code: beforeValidation.code, message: beforeValidation.message } };
    }
    const afterValidation = validateTextAnchor(afterAnchor);
    if (!afterValidation.ok) {
      return { ok: false, error: { code: afterValidation.code, message: afterValidation.message } };
    }
    if (!isTextAnchor(beforeAnchor)) {
      return {
        ok: false,
        error: { code: "ANCHOR_TYPE_INVALID", message: "before must be text anchor." }
      };
    }
    if (!replacement) {
      return {
        ok: false,
        error: { code: "ANCHOR_VALUE_MISSING", message: "Replacement is required." }
      };
    }

    let idx = searchFrom;
    while (idx <= normalizedBefore.length) {
      const beforeIndex = normalizedBefore.indexOf(beforeAnchor.value, idx);
      if (beforeIndex === -1) {
        break;
      }
      const beforeEnd = beforeIndex + beforeAnchor.value.length;
      if (isEofAnchor(afterAnchorSafe)) {
        matches.push({
          start: beforeIndex,
          end: normalizedBefore.length,
          beforeEnd,
          afterStart: normalizedBefore.length,
          beforeValue: beforeAnchor.value,
          afterValue: "<eof>"
        });
      } else {
        const afterIndex = normalizedBefore.indexOf(afterAnchorSafe.value, beforeEnd);
        if (afterIndex !== -1) {
          const afterEnd = afterIndex + afterAnchorSafe.value.length;
          matches.push({
            start: beforeIndex,
            end: afterEnd,
            beforeEnd,
            afterStart: afterIndex,
            beforeValue: beforeAnchor.value,
            afterValue: afterAnchorSafe.value
          });
        }
      }
      idx = beforeEnd;
    }

    if (matches.length === 0) {
      const beforeExists = normalizedBefore.includes(beforeAnchor.value);
      return {
        ok: false,
        error: {
          code: beforeExists ? "AFTER_NOT_FOUND" : "BEFORE_NOT_FOUND",
          message: beforeExists
            ? "End anchor not found after start anchor."
            : "Start anchor not found.",
          details: {
            before: beforeAnchor,
            after: afterAnchor
          }
        }
      };
    }

    if (matches.length !== expectedOccurrences) {
      return {
        ok: false,
        error: {
          code: "AMBIGUOUS_MATCH",
          message: "Anchor match count does not match expectedOccurrences.",
          details: {
            expectedOccurrences,
            actualOccurrences: matches.length,
            ranges: matches.map((m) => ({ start: m.start, end: m.end, before: m.beforeValue, after: m.afterValue }))
          }
        }
      };
    }

    const overlapCheck = checkOverlaps(matches, normalizedBefore);
    if (!overlapCheck.ok) {
      return {
        ok: false,
        error: {
          code: overlapCheck.code,
          message: overlapCheck.message,
          details: overlapCheck.details
        }
      };
    }

    const match = matches[0];
    replaceStart = match.beforeEnd;
    replaceEnd = match.afterStart;
    replacementText = replacement;
  } else if (input.mode === "insert_after") {
    // Insert text immediately after an anchor match.
    const anchor = input.anchor;
    const text = input.text ?? "";
    const anchorValidation = validateTextAnchor(anchor);
    if (!anchorValidation.ok) {
      return { ok: false, error: { code: anchorValidation.code, message: anchorValidation.message } };
    }
    if (!isTextAnchor(anchor)) {
      return {
        ok: false,
        error: {
          code: "ANCHOR_NOT_ALLOWED",
          message: "insert_after does not allow eof anchor. Use append mode."
        }
      };
    }
    if (!text) {
      return {
        ok: false,
        error: { code: "ANCHOR_VALUE_MISSING", message: "Text is required for insert_after." }
      };
    }

    let idx = searchFrom;
    while (idx <= normalizedBefore.length) {
      const anchorIndex = normalizedBefore.indexOf(anchor.value, idx);
      if (anchorIndex === -1) {
        break;
      }
      const anchorEnd = anchorIndex + anchor.value.length;
      matches.push({
        start: anchorIndex,
        end: anchorEnd,
        beforeEnd: anchorEnd,
        afterStart: anchorEnd,
        beforeValue: anchor.value
      });
      idx = anchorEnd;
    }

    if (matches.length === 0) {
      return {
        ok: false,
        error: {
          code: "BEFORE_NOT_FOUND",
          message: "Anchor not found.",
          details: { anchor }
        }
      };
    }

    if (matches.length !== expectedOccurrences) {
      return {
        ok: false,
        error: {
          code: "AMBIGUOUS_MATCH",
          message: "Anchor match count does not match expectedOccurrences.",
          details: {
            expectedOccurrences,
            actualOccurrences: matches.length,
            ranges: matches.map((m) => ({ start: m.start, end: m.end, anchor: m.beforeValue }))
          }
        }
      };
    }

    const overlapCheck = checkOverlaps(matches, normalizedBefore);
    if (!overlapCheck.ok) {
      return {
        ok: false,
        error: {
          code: overlapCheck.code,
          message: overlapCheck.message,
          details: overlapCheck.details
        }
      };
    }

    const match = matches[0];
    replaceStart = match.afterStart;
    replaceEnd = match.afterStart;
    replacementText = text;
  } else if (input.mode === "append") {
    // Append text to end-of-file.
    const text = input.text ?? "";
    if (!text) {
      return {
        ok: false,
        error: { code: "ANCHOR_VALUE_MISSING", message: "Text is required for append." }
      };
    }
    replaceStart = normalizedBefore.length;
    replaceEnd = normalizedBefore.length;
    replacementText = text;
    matches.push({
      start: normalizedBefore.length,
      end: normalizedBefore.length,
      beforeEnd: normalizedBefore.length,
      afterStart: normalizedBefore.length,
      beforeValue: "<eof>"
    });
  } else {
    return {
      ok: false,
      error: { code: "INVALID_MODE", message: "Unsupported mode", details: { mode: input.mode } }
    };
  }

  const afterText =
    normalizedBefore.slice(0, replaceStart) +
    replacementText +
    normalizedBefore.slice(replaceEnd);

  const maxBytes = 2 * 1024 * 1024;
  if (byteSize(afterText) > maxBytes) {
    return {
      ok: false,
      error: {
        code: "TOO_LARGE",
        message: "Edit exceeds max size",
        details: { maxBytes }
      }
    };
  }

  const dir = path.dirname(resolved.absPath);
  const tmp = path.join(dir, `.tmp-${path.basename(resolved.absPath)}-${crypto.randomUUID()}`);
  try {
    await fs.writeFile(tmp, afterText, "utf8");
    await fs.rename(tmp, resolved.absPath);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "WRITE_FAILED",
        message: "Failed to write file",
        details: { error: String(error) }
      }
    };
  }

  return {
    ok: true,
    shaBefore,
    shaAfter: sha256(afterText),
    bytesBefore: byteSize(normalizedBefore),
    bytesAfter: byteSize(afterText),
    match: {
      startOffset: replaceStart,
      endOffset: replaceEnd,
      startLine: indexToLine(normalizedBefore, replaceStart),
      endLine: indexToLine(normalizedBefore, replaceEnd),
      occurrences: matches.length
    }
  };
}
