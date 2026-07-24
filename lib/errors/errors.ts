// Error taxonomy for the whole app. Every layer imports from here.
// Adapters map AWS SDK errors into these; routes map these to HTTP + readable messages.

export type AppErrorCode =
  | "NOTEBOOK_NOT_FOUND"
  | "DOCUMENT_NOT_FOUND"
  | "JOB_NOT_FOUND"
  | "MODEL_LOCKED"
  | "MODEL_NOT_FOUND"
  | "STRATEGY_NOT_FOUND"
  | "STRATEGY_NOT_APPLICABLE"
  | "LOADER_ERROR"
  | "EMPTY_DOCUMENT"
  | "OVERSIZE_FILE"
  | "UNSUPPORTED_FILE_TYPE"
  | "INVALID_PATH"
  | "DIMENSION_MISMATCH"
  | "BEDROCK_ACCESS_DENIED"
  | "BEDROCK_THROTTLED"
  | "BEDROCK_VALIDATION"
  | "BEDROCK_TIMEOUT"
  | "BEDROCK_ERROR"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  /** true when safe to show `message` verbatim to the end user */
  readonly readable: boolean;

  constructor(code: AppErrorCode, message: string, httpStatus = 500, readable = true) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.readable = readable;
  }
}

export class NotebookNotFound extends AppError {
  constructor(id: string) {
    super("NOTEBOOK_NOT_FOUND", `Notebook not found: ${id}`, 404);
    this.name = "NotebookNotFound";
  }
}

export class DocumentNotFound extends AppError {
  constructor(id: string) {
    super("DOCUMENT_NOT_FOUND", `Document not found: ${id}`, 404);
    this.name = "DocumentNotFound";
  }
}

export class JobNotFound extends AppError {
  constructor(id: string) {
    super("JOB_NOT_FOUND", `Job not found: ${id}`, 404);
    this.name = "JobNotFound";
  }
}

export class ModelLocked extends AppError {
  constructor(notebookId: string) {
    super(
      "MODEL_LOCKED",
      `The embedding model is locked: notebook ${notebookId} already has documents. Changing the model would invalidate its stored vectors.`,
      409
    );
    this.name = "ModelLocked";
  }
}

export class ModelNotFound extends AppError {
  constructor(id: string) {
    super("MODEL_NOT_FOUND", `Model not in registry: ${id}`, 400);
    this.name = "ModelNotFound";
  }
}

export class StrategyNotFound extends AppError {
  constructor(id: string) {
    super("STRATEGY_NOT_FOUND", `Chunking strategy not found: ${id}`, 400);
    this.name = "StrategyNotFound";
  }
}

export class StrategyNotApplicable extends AppError {
  constructor(strategyId: string, fileType: string) {
    super("STRATEGY_NOT_APPLICABLE", `Strategy '${strategyId}' is not applicable to .${fileType} files.`, 400);
    this.name = "StrategyNotApplicable";
  }
}

export class LoaderError extends AppError {
  constructor(message: string) {
    super("LOADER_ERROR", message, 422);
    this.name = "LoaderError";
  }
}

export class EmptyDocument extends AppError {
  constructor() {
    super("EMPTY_DOCUMENT", "empty document", 422);
    this.name = "EmptyDocument";
  }
}

export class OversizeFile extends AppError {
  constructor(sizeBytes: number, maxMb: number) {
    super(
      "OVERSIZE_FILE",
      `File is ${(sizeBytes / 1024 / 1024).toFixed(1)}MB — exceeds the ${maxMb}MB limit.`,
      413
    );
    this.name = "OversizeFile";
  }
}

export class UnsupportedFileType extends AppError {
  constructor(fileType: string) {
    super("UNSUPPORTED_FILE_TYPE", `Unsupported file type: .${fileType}`, 400);
    this.name = "UnsupportedFileType";
  }
}

export class InvalidPath extends AppError {
  constructor(detail: string) {
    super("INVALID_PATH", `Invalid path segment: ${detail}`, 400);
    this.name = "InvalidPath";
  }
}

export class DimensionMismatch extends AppError {
  constructor(expected: number, actual: number, modelId: string) {
    super(
      "DIMENSION_MISMATCH",
      `Embedding dimension mismatch: model ${modelId} returned ${actual}, notebook expects ${expected}. Refusing to store corrupt vectors.`,
      500
    );
    this.name = "DimensionMismatch";
  }
}

export class BedrockError extends AppError {
  constructor(code: AppErrorCode, message: string, httpStatus: number) {
    super(code, message, httpStatus);
    this.name = "BedrockError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message, 400);
    this.name = "ValidationError";
  }
}

/** Structural check instead of instanceof: class identity differs across bundling
 *  contexts / HMR generations (route vs globalThis-cached container). */
function isAppError(err: unknown): err is AppError {
  return (
    err instanceof Error &&
    typeof (err as AppError).code === "string" &&
    typeof (err as AppError).httpStatus === "number" &&
    typeof (err as AppError).readable === "boolean"
  );
}

/** Maps any thrown value to a { code, message, httpStatus } safe to surface to the user. */
export function toReadable(err: unknown): { code: AppErrorCode; message: string; httpStatus: number } {
  if (isAppError(err)) {
    return {
      code: err.code,
      message: err.readable ? err.message : "An internal error occurred.",
      httpStatus: err.httpStatus,
    };
  }
  if (err instanceof Error && err.name === "AbortError") {
    return { code: "INTERNAL_ERROR", message: "Request aborted.", httpStatus: 499 };
  }
  return { code: "INTERNAL_ERROR", message: "An internal error occurred.", httpStatus: 500 };
}
