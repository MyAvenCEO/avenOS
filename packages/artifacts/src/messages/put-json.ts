import type { OptionalReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";
import type { JsonValue } from "typed-actors";

export interface PutJsonMessage extends OptionalReplyableMessage<"putJson"> {
  readonly type: "putJson";
  readonly value: JsonValue;
  readonly filename?: string;
}