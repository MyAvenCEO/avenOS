import type { JsonValue } from "typed-actors";

/**
 * Shared top-level error categories used across Aven actor-facing contracts.
 */
export const ErrorCategory = {
  InvalidRequest: "invalidRequest",
  Configuration: "configuration",
  NotFound: "notFound",
  Conflict: "conflict",
  Timeout: "timeout",
  QueueFull: "queueFull",
  ProviderError: "providerError",
  Infrastructure: "infrastructure",
  OperationFailed: "operationFailed",
  OutputInvalid: "outputInvalid",
} as const;

/**
 * Union of shared top-level error category literals.
 */
export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

/**
 * Shared public error payload shape for actor-facing contracts.
 */
export interface ErrorDescriptor {
  /** Top-level cross-domain error category. */
  readonly category: ErrorCategory;
  /** Stable domain or subsystem-specific error code. */
  readonly code: string;
  /** Human-readable explanation of the error. */
  readonly message: string;
  /** Optional structured details for debugging or inspection. */
  readonly details?: JsonValue;
}
