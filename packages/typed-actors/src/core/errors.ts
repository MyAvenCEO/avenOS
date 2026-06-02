import type { ActorErrorCode } from "./constants.js";

export interface SerializedRuntimeError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export function serializeRuntimeError(error: unknown): SerializedRuntimeError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: typeof error,
    message: String(error),
  };
}

export class ActorSystemError extends Error {
  readonly code: ActorErrorCode;

  constructor(code: ActorErrorCode, message: string) {
    super(message);
    this.name = "ActorSystemError";
    this.code = code;
  }
}

export class InvalidJsonValueError extends ActorSystemError {
  constructor(code: ActorErrorCode, message: string) {
    super(code, message);
    this.name = "InvalidJsonValueError";
  }
}

export class PersistenceConflictError extends ActorSystemError {
  constructor(code: ActorErrorCode, message: string) {
    super(code, message);
    this.name = "PersistenceConflictError";
  }
}