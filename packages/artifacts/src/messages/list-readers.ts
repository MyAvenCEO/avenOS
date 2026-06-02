import type { ReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";

export interface ListReadersMessage extends ReplyableMessage<"listReaders"> {
  readonly type: "listReaders";
}