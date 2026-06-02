import type { ReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";
import type { SchemaRef } from "../types/schema-ref.ts";

export interface GetSchemaVersionRequest extends ReplyableMessage<"getSchemaVersionRequest"> {
  readonly type: "getSchemaVersionRequest";
  readonly schemaRef: SchemaRef;
}