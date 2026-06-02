import type { OptionalReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";

export interface GetMetadataRecordMessage extends OptionalReplyableMessage<"getMetadataRecord"> {
  readonly recordId: string;
}