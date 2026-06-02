import type { OptionalReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";
import type { MetadataQueryRecordsInput } from "../types/metadata-query-records-input.ts";

export interface QueryMetadataRecordsMessage extends OptionalReplyableMessage<"queryMetadataRecords"> {
  readonly query: MetadataQueryRecordsInput;
}