import type { CorrelationMetadata } from "./correlation-metadata.ts";
import type { ReplyAddress } from "./reply-address.ts";

/**
 * Minimal base shape for actor messages.
 */
export interface ActorMessage<TType extends string = string> {
  /** Protocol-level message discriminator. */
  readonly type: TType;
}

/**
 * Base shape for messages that participate in correlated request flows.
 */
export interface CorrelatedMessage<TType extends string = string> extends ActorMessage<TType>, CorrelationMetadata {}

/**
 * Base shape for request messages that may participate in a correlated async flow
 * while still allowing fire-and-forget usage.
 */
export interface OptionalCorrelatedMessage<TType extends string = string> extends ActorMessage<TType> {
  /** Stable request correlation id within the local contract scope when present. */
  readonly requestId?: string;
}

/**
 * Base shape for request messages that declare a completion destination.
 */
export interface ReplyableMessage<TType extends string = string, TKind extends string = string>
  extends CorrelatedMessage<TType> {
  /** Address to which the correlated completion must be sent. */
  readonly replyTo: ReplyAddress<TKind>;
}

/**
 * Base shape for request messages that optionally declare correlation and completion
 * routing when used as part of an async request/completion flow.
 */
export interface OptionalReplyableMessage<TType extends string = string, TKind extends string = string>
  extends OptionalCorrelatedMessage<TType> {
  /** Address to which the correlated completion should be sent when requested. */
  readonly replyTo?: ReplyAddress<TKind>;
}
