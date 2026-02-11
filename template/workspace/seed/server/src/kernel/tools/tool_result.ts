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
  | "INTERNAL";

export type ToolOk<T> = { ok: true; result: T; warnings?: string[] };

export type ToolErr = {
  ok: false;
  error: {
    code: ToolErrorCode;
    message: string;
    details?: unknown;
  };
};

export type ToolResult<T> = ToolOk<T> | ToolErr;
