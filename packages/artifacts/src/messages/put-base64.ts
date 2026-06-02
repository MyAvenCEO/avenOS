import type { OptionalReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";

export interface PutBase64Message extends OptionalReplyableMessage<"putBase64"> {
  readonly type: "putBase64";
  readonly base64: string;
  readonly declaredMimeType?: string;
  readonly filename?: string;
}