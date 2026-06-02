import type { OptionalReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";
import type { JsonValue } from "typed-actors";
import type { SchemaRef } from "schema-contracts";
import type { MetadataSubject } from "../types/metadata-subject.ts";

export interface CreateMetadataRecordMessage extends OptionalReplyableMessage<"createMetadataRecord"> {
  readonly subject: MetadataSubject;
  readonly schemaRef: SchemaRef;
  readonly value: JsonValue;
  readonly idempotencyKey?: string;
  readonly previousRecordId?: string;
}