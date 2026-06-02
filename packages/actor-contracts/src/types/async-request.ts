/**
 * Shared pending-result shape for actor-native async request lifecycles.
 *
 * This is a public contract type used when an actor accepts a correlated request,
 * has not completed it yet, and wants to expose the currently awaited next step.
 */
export interface PendingAsyncResult<TAwaiting extends string = string> {
  /** Stable request correlation id for the in-flight async operation. */
  readonly requestId: string;
  /** Lifecycle step that the actor is currently waiting on. */
  readonly awaiting: TAwaiting;
  /** Shared pending lifecycle discriminator. */
  readonly type: "pending";
  /** Optional deadline after which the pending request should be considered expired. */
  readonly deadlineAt?: string;
}