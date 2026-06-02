import type { JsonValue } from "typed-actors";
import type { ReplyAddress } from "shared";

export interface RecordStartedIntentMessage {
  readonly type: "recordStartedIntent";
  readonly requestId?: string;
  readonly replyTo?: ReplyAddress;
  readonly intentId: string;
  readonly decision: "createdNew" | "matchedExisting";
  readonly message: string;
  readonly attachmentRefs: ReadonlyArray<{
    readonly filename: string;
    readonly mediaRole: string;
    readonly ref: JsonValue;
  }>;
}