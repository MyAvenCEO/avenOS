import type { OptionalReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";

export interface PutTextMessage extends OptionalReplyableMessage<"putText"> {
  readonly type: "putText";
  readonly text: string;
  readonly declaredMimeType?: string;
  readonly filename?: string;
}