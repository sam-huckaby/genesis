export type ToolErrorCode =
  | "INVALID_ARGS"
  | "NOT_FOUND"
  | "NOT_ALLOWED"
  | "IO_ERROR"
  | "TOO_LARGE"
  | "GIT_ERROR"
  | "PATCH_APPLY_FAILED"
  | "PRECONDITION_FAILED"
  | "CONFLICT"
  | "INTERNAL"
  | "PATH_ABSOLUTE"
  | "PATH_TRAVERSAL"
  | "PATH_OUTSIDE_ROOT"
  | "PATH_SYMLINK_ESCAPE"
  | "PATH_ANCESTOR_MISSING"
  | "DENYLIST_PATH"
  | "READ_FAILED"
  | "WRITE_FAILED"
  | "INVALID_MODE"
  | "BEFORE_NOT_FOUND"
  | "AFTER_NOT_FOUND"
  | "AMBIGUOUS_MATCH"
  | "OVERLAPPING_ANCHORS"
  | "ANCHOR_REQUIRED"
  | "ANCHOR_TYPE_INVALID"
  | "ANCHOR_VALUE_MISSING"
  | "ANCHOR_NOT_ALLOWED"
  | "EMPTY_PATCH"
  | "TOO_MANY_FILES"
  | "PATCH_TOO_LARGE"
  | "FILE_TOO_LARGE"
  | "FILE_NOT_FOUND"
  | "CREATE_BUT_EXISTS"
  | "DELETE_NOT_SUPPORTED"
  | "RENAME_NOT_SUPPORTED"
  | "BINARY_PATCH_NOT_SUPPORTED"
  | "MALFORMED_DIFF"
  | "MALFORMED_HUNK_HEADER"
  | "MALFORMED_HUNK_LINE"
  | "HUNK_OUT_OF_BOUNDS"
  | "HUNK_FAILED"
  | "TEMP_WRITE_FAILED"
  | "COMMIT_FAILED";

export type ToolOk<T> = { ok: true; warnings?: string[] } & T;

export type ToolErr = {
  ok: false;
  error: {
    code: ToolErrorCode;
    message: string;
    hint?: string;
    details?: unknown;
  };
};

export type ToolResult<T> = ToolOk<T> | ToolErr;
