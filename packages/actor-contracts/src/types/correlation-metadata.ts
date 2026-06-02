/**
 * Shared correlation fields for request/completion message flows.
 */
export interface CorrelationMetadata {
  /** Stable request correlation id within the local contract scope. */
  readonly requestId: string;
}
